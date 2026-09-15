use std::process::{ExitStatus, Stdio};

use mcpatch_bridge::{
    installation::STABLE_EXTENSION_ORIGIN,
    native_host::{read_message, write_message},
    protocol::{Hello, Implementation, Message, PROTOCOL_VERSION, Role},
};
use tokio::{
    io::AsyncReadExt,
    process::{Child, Command},
    time::timeout,
};

use super::{TEST_TIMEOUT, runtime::TestDirectory, runtime::configure_runtime_environment};

const ALLOWED_ORIGIN: &str = STABLE_EXTENSION_ORIGIN;

pub(crate) struct BrowserAdapter {
    child: Child,
    connection_id: String,
}

impl BrowserAdapter {
    pub(crate) async fn connect(fixture: &TestDirectory) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_mcpatch"));
        child
            .arg(ALLOWED_ORIGIN)
            .env("MCPATCH_LOG", "trace")
            .env("RUST_LOG", "trace")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        configure_runtime_environment(&mut child, fixture.path());
        let mut child = child.spawn().expect("native host must spawn");

        write_message(
            child.stdin.as_mut().expect("native stdin must be piped"),
            &Message::Hello(Hello {
                protocol_version: PROTOCOL_VERSION,
                role: Role::Extension,
                supported_protocol_versions: vec![PROTOCOL_VERSION],
                implementation: Implementation {
                    name: "mcpatch-extension-process-test".to_owned(),
                    version: "0.1.0".to_owned(),
                },
            }),
        )
        .await
        .expect("browser hello must be writable");

        let Message::HelloAck(acknowledgement) = read(&mut child).await else {
            panic!("bridge must acknowledge the browser hello");
        };
        assert_eq!(acknowledgement.protocol_version, PROTOCOL_VERSION);
        assert_eq!(acknowledgement.selected_protocol_version, PROTOCOL_VERSION);
        Self {
            child,
            connection_id: acknowledgement.connection_id,
        }
    }

    pub(crate) fn connection_id(&self) -> &str {
        &self.connection_id
    }

    pub(crate) async fn send(&mut self, message: Message) {
        write_message(
            self.child
                .stdin
                .as_mut()
                .expect("native stdin must be piped"),
            &message,
        )
        .await
        .expect("browser message must be writable");
    }

    pub(crate) async fn receive(&mut self) -> Message {
        read(&mut self.child).await
    }

    pub(crate) async fn finish_clean(mut self) {
        drop(self.child.stdin.take());
        let output = collect(self.child).await;
        assert!(output.status.success(), "native host must stop cleanly");
        assert!(output.stdout.is_empty());
        assert_audit_safe(&output.stderr);
    }
}

async fn read(child: &mut Child) -> Message {
    timeout(
        TEST_TIMEOUT,
        read_message(child.stdout.as_mut().expect("native stdout must be piped")),
    )
    .await
    .expect("browser response timed out")
    .expect("browser response must be a valid frame")
    .expect("native host closed before returning a browser message")
}

struct ProcessOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: String,
}

async fn collect(mut child: Child) -> ProcessOutput {
    let mut stdout = child.stdout.take().expect("native stdout must be piped");
    let mut stderr = child.stderr.take().expect("native stderr must be piped");
    let stdout_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).await.unwrap();
        bytes
    });
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).await.unwrap();
        bytes
    });
    let status = timeout(TEST_TIMEOUT, child.wait())
        .await
        .expect("native host did not stop")
        .expect("native host must be waitable");
    drop(child.stdin.take());
    ProcessOutput {
        status,
        stdout: stdout_task.await.unwrap(),
        stderr: String::from_utf8(stderr_task.await.unwrap()).unwrap(),
    }
}

fn assert_audit_safe(stderr: &str) {
    assert!(!stderr.contains(ALLOWED_ORIGIN));
    assert!(!stderr.contains("https://demo.mcpatch.invalid"));
    assert!(!stderr.contains("mcpatch.demo.status"));
    assert!(!stderr.is_empty());
    for line in stderr.lines() {
        let value: serde_json::Value =
            serde_json::from_str(line).expect("native-host diagnostics must be JSON lines");
        assert_eq!(value["target"], "mcpatch");
        assert!(value["event"].is_string());
    }
}
