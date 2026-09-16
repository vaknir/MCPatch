#![cfg(any(unix, windows))]

use std::{
    fs,
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

use mcpatch_bridge::{
    bridge_core::{BridgeCoreError, CoreStopReason},
    installation::STABLE_EXTENSION_ORIGIN,
    local_ipc::InstallChannel,
    native_host::{read_message, write_message},
    protocol::{
        Heartbeat, Hello, HelloAck, Implementation, Message, PROTOCOL_VERSION, Role, ToolCall,
    },
};
use serde_json::{Map, json};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    task::JoinHandle,
    time::timeout,
};
use tokio_util::sync::CancellationToken;

#[cfg(unix)]
use mcpatch_bridge::{bridge_core::UnixBridgeCore, local_ipc::UnixRuntime};
#[cfg(windows)]
use mcpatch_bridge::{bridge_core::WindowsBridgeCore, local_ipc::WindowsRuntime};

const ALLOWED_ORIGIN: &str = STABLE_EXTENSION_ORIGIN;
const TEST_TIMEOUT: Duration = Duration::from_secs(5);
const QUIET_INTERVAL: Duration = Duration::from_millis(100);

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn browser_negotiation_survives_violations_disconnect_and_core_restart() {
    timeout(TEST_TIMEOUT * 6, run_scenario())
        .await
        .expect("browser adapter scenario exceeded its deterministic bound");
}

async fn run_scenario() {
    let fixture = TestDirectory::new();
    let first_core = start_core(&fixture).await;

    let (mut wrong_direction_host, first_id) = negotiate(&fixture).await;
    send(&mut wrong_direction_host, heartbeat("accepted-heartbeat")).await;
    assert_still_running(&mut wrong_direction_host).await;
    send(
        &mut wrong_direction_host,
        wrong_direction_call("private-wrong-direction-marker"),
    )
    .await;
    assert_failed(
        finish_after_peer_close(wrong_direction_host).await,
        "local_ipc_closed",
        "private-wrong-direction-marker",
    );

    reject_before_negotiation(&fixture).await;
    reject_wrong_version(&fixture).await;

    let (disconnected_host, second_id) = negotiate(&fixture).await;
    assert_ne!(second_id, first_id);
    assert_clean(finish_after_input_close(disconnected_host).await);

    let (mut restarted_session, third_id) = negotiate(&fixture).await;
    assert_ne!(third_id, second_id);
    assert_no_replayed_output(&mut restarted_session).await;
    send(
        &mut restarted_session,
        heartbeat("private-restart-heartbeat"),
    )
    .await;
    assert_still_running(&mut restarted_session).await;

    first_core.stop().await;
    assert_failed(
        finish_after_peer_close(restarted_session).await,
        "local_ipc_closed",
        "private-restart-heartbeat",
    );

    let second_core = start_core(&fixture).await;
    let (final_host, post_restart_id) = negotiate(&fixture).await;
    assert_ne!(post_restart_id, third_id);
    assert_clean(finish_after_input_close(final_host).await);
    second_core.stop().await;
}

async fn reject_before_negotiation(fixture: &TestDirectory) {
    let mut host = spawn_native_host(fixture);
    send(&mut host, heartbeat("private-pre-negotiation-heartbeat")).await;
    assert_failed(
        finish_after_peer_close(host).await,
        "local_ipc_closed",
        "private-pre-negotiation-heartbeat",
    );
}

async fn reject_wrong_version(fixture: &TestDirectory) {
    let (mut host, _) = negotiate(fixture).await;
    write_raw_json(
        &mut host,
        &json!({
            "protocolVersion": PROTOCOL_VERSION + 1,
            "type": "heartbeat",
            "heartbeatId": "private-wrong-version-marker",
            "sentAt": "2026-09-15T00:00:00Z"
        }),
    )
    .await;
    assert_failed(
        finish_after_peer_close(host).await,
        "native_message_invalid_protocol",
        "private-wrong-version-marker",
    );
}

async fn negotiate(fixture: &TestDirectory) -> (Child, String) {
    let mut host = spawn_native_host(fixture);
    send(&mut host, hello()).await;
    let message = timeout(
        TEST_TIMEOUT,
        read_message(host.stdout.as_mut().expect("native stdout must be piped")),
    )
    .await
    .expect("hello acknowledgement timed out")
    .expect("hello acknowledgement must be a valid native frame")
    .expect("native host closed before acknowledging hello");
    let Message::HelloAck(acknowledgement) = message else {
        panic!("first bridge message must be hello_ack");
    };
    assert_acknowledgement(&acknowledgement);
    (host, acknowledgement.connection_id)
}

fn assert_acknowledgement(acknowledgement: &HelloAck) {
    assert_eq!(acknowledgement.protocol_version, PROTOCOL_VERSION);
    assert_eq!(
        acknowledgement.supported_protocol_versions,
        vec![PROTOCOL_VERSION]
    );
    assert_eq!(acknowledgement.selected_protocol_version, PROTOCOL_VERSION);
    assert!(acknowledgement.connection_id.starts_with("browser."));
}

async fn send(host: &mut Child, message: Message) {
    write_message(
        host.stdin.as_mut().expect("native stdin must be piped"),
        &message,
    )
    .await
    .expect("native protocol message must be writable");
}

async fn write_raw_json(host: &mut Child, value: &serde_json::Value) {
    let payload = serde_json::to_vec(value).unwrap();
    let input = host.stdin.as_mut().expect("native stdin must be piped");
    input
        .write_all(&u32::try_from(payload.len()).unwrap().to_ne_bytes())
        .await
        .unwrap();
    input.write_all(&payload).await.unwrap();
    input.flush().await.unwrap();
}

async fn assert_still_running(host: &mut Child) {
    tokio::time::sleep(QUIET_INTERVAL).await;
    assert!(
        host.try_wait()
            .expect("native host status must be readable")
            .is_none(),
        "accepted heartbeat must keep the negotiated session open"
    );
}

async fn assert_no_replayed_output(host: &mut Child) {
    let read = read_message(host.stdout.as_mut().expect("native stdout must be piped"));
    assert!(
        timeout(QUIET_INTERVAL, read).await.is_err(),
        "a fresh native session must not receive prior-session output"
    );
}

fn spawn_native_host(fixture: &TestDirectory) -> Child {
    let mut command = Command::new(env!("CARGO_BIN_EXE_mcpatch"));
    command
        .arg(ALLOWED_ORIGIN)
        .env("MCPATCH_LOG", "trace")
        .env("RUST_LOG", "trace")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_runtime_environment(&mut command, fixture.path());
    command.spawn().expect("native host must spawn")
}

async fn finish_after_input_close(mut child: Child) -> HostOutcome {
    drop(child.stdin.take());
    collect_host(child, false).await
}

async fn finish_after_peer_close(child: Child) -> HostOutcome {
    collect_host(child, true).await
}

async fn collect_host(mut child: Child, preserve_input_until_exit: bool) -> HostOutcome {
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

    let status = if preserve_input_until_exit {
        wait_without_closing_input(&mut child).await
    } else {
        timeout(TEST_TIMEOUT, child.wait())
            .await
            .expect("native host timed out")
            .expect("native host must be waitable")
    };
    drop(child.stdin.take());

    HostOutcome {
        status,
        stdout: stdout_task.await.unwrap(),
        stderr: String::from_utf8(stderr_task.await.unwrap()).unwrap(),
    }
}

async fn wait_without_closing_input(child: &mut Child) -> ExitStatus {
    timeout(TEST_TIMEOUT, async {
        loop {
            if let Some(status) = child
                .try_wait()
                .expect("native host status must be readable")
            {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("native host did not close after its peer failed")
}

fn assert_clean(outcome: HostOutcome) {
    assert!(outcome.status.success());
    assert!(outcome.stdout.is_empty());
    assert!(outcome.stderr.contains(r#""event":"native_host_stopped""#));
    assert_audit_safe(&outcome.stderr, "unused-clean-marker");
}

fn assert_failed(outcome: HostOutcome, expected_code: &str, private_marker: &str) {
    assert!(!outcome.status.success());
    assert!(outcome.stdout.is_empty());
    assert!(
        outcome
            .stderr
            .contains(&format!(r#""code":"{expected_code}""#)),
        "unexpected native-host diagnostics: {}",
        outcome.stderr
    );
    assert_audit_safe(&outcome.stderr, private_marker);
}

fn assert_audit_safe(stderr: &str, private_marker: &str) {
    assert!(!stderr.contains(ALLOWED_ORIGIN));
    assert!(!stderr.contains(private_marker));
    assert!(!stderr.is_empty());
    for line in stderr.lines() {
        let value: serde_json::Value =
            serde_json::from_str(line).expect("native-host diagnostics must be JSON lines");
        assert_eq!(value["target"], "mcpatch");
        assert!(value["event"].is_string());
    }
}

fn hello() -> Message {
    Message::Hello(Hello {
        protocol_version: PROTOCOL_VERSION,
        role: Role::Extension,
        supported_protocol_versions: vec![PROTOCOL_VERSION],
        implementation: Implementation {
            name: "mcpatch-extension".to_owned(),
            version: "0.1.0".to_owned(),
        },
    })
}

fn heartbeat(id: &str) -> Message {
    Message::Heartbeat(Heartbeat {
        protocol_version: PROTOCOL_VERSION,
        heartbeat_id: id.to_owned(),
        sent_at: "2026-09-15T00:00:00Z".to_owned(),
    })
}

fn wrong_direction_call(marker: &str) -> Message {
    Message::ToolCall(ToolCall {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".to_owned(),
        context_id: "tab-1".to_owned(),
        context_revision: 1,
        origin: "https://example.com".to_owned(),
        tool: "demo.read".to_owned(),
        args: Map::from_iter([("private".to_owned(), marker.into())]),
    })
}

struct HostOutcome {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: String,
}

struct RunningCore {
    shutdown: CancellationToken,
    task: JoinHandle<Result<CoreStopReason, BridgeCoreError>>,
}

impl RunningCore {
    async fn stop(self) {
        self.shutdown.cancel();
        let reason = timeout(TEST_TIMEOUT, self.task)
            .await
            .expect("bridge core shutdown timed out")
            .expect("bridge core task must join")
            .expect("bridge core must stop cleanly");
        assert_eq!(reason, CoreStopReason::Shutdown);
    }
}

#[cfg(unix)]
async fn start_core(fixture: &TestDirectory) -> RunningCore {
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Production)
        .await
        .expect("test runtime must be private");
    let core = UnixBridgeCore::start(runtime)
        .await
        .expect("bridge core must start");
    let shutdown = CancellationToken::new();
    let task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
    RunningCore { shutdown, task }
}

#[cfg(windows)]
async fn start_core(_fixture: &TestDirectory) -> RunningCore {
    let runtime = WindowsRuntime::current(InstallChannel::Production)
        .expect("test runtime must be available");
    let core = WindowsBridgeCore::start(runtime).expect("bridge core must start");
    let shutdown = CancellationToken::new();
    let task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
    RunningCore { shutdown, task }
}

#[cfg(target_os = "linux")]
fn configure_runtime_environment(command: &mut Command, runtime_base: &Path) {
    command.env("XDG_RUNTIME_DIR", runtime_base);
}

#[cfg(target_os = "macos")]
fn configure_runtime_environment(command: &mut Command, runtime_base: &Path) {
    command.env("TMPDIR", runtime_base);
}

#[cfg(windows)]
fn configure_runtime_environment(_command: &mut Command, _runtime_base: &Path) {}

static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .subsec_nanos();
        let path = std::env::temp_dir().join(format!(
            "a{:x}{sequence:x}{:04x}",
            std::process::id(),
            timestamp & 0xffff
        ));
        create_private_directory(&path);
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(unix)]
fn create_private_directory(path: &Path) {
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700).create(path).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
}

#[cfg(windows)]
fn create_private_directory(path: &Path) {
    fs::create_dir(path).unwrap();
}
