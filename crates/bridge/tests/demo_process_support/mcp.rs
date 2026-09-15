use std::process::{ExitStatus, Stdio};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdout, Command},
    time::timeout,
};

use super::{TEST_TIMEOUT, runtime::TestDirectory, runtime::configure_runtime_environment};

pub(crate) struct McpClient {
    child: Child,
    next_id: u64,
    stdout: BufReader<ChildStdout>,
}

impl McpClient {
    pub(crate) async fn connect(fixture: &TestDirectory) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_mcpatch"));
        command
            .arg("mcp-stdio")
            .env("MCPATCH_LOG", "trace")
            .env("RUST_LOG", "trace")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        configure_runtime_environment(&mut command, fixture.path());
        let mut child = command.spawn().expect("MCP stdio adapter must spawn");
        let stdout = BufReader::new(child.stdout.take().expect("MCP stdout must be piped"));
        let mut client = Self {
            child,
            next_id: 2,
            stdout,
        };

        client
            .write(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "demo-process-test", "version": "0.1.0"}
                }
            }))
            .await;
        let response = client.read().await;
        assert_eq!(response["id"], 1);
        assert_eq!(response["result"]["serverInfo"]["name"], "mcpatch");
        client
            .write(json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {}
            }))
            .await;
        client
    }

    pub(crate) async fn list_tools(&mut self) -> Vec<Value> {
        let id = self.take_id();
        self.write(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/list",
            "params": {}
        }))
        .await;
        let response = self.read_response(id).await;
        response["result"]["tools"].as_array().unwrap().clone()
    }

    pub(crate) async fn wait_for_tool_count(&mut self, expected: usize) -> Vec<Value> {
        timeout(TEST_TIMEOUT, async {
            for _ in 0..100 {
                let tools = self.list_tools().await;
                if tools.len() == expected {
                    return tools;
                }
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            }
            panic!("tool count did not converge to {expected}");
        })
        .await
        .unwrap_or_else(|_| panic!("tool count did not converge to {expected}"))
    }

    pub(crate) async fn start_call(&mut self) -> u64 {
        let id = self.take_id();
        self.write(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": "mcpatch.demo.status", "arguments": {}}
        }))
        .await;
        id
    }

    pub(crate) async fn read_response(&mut self, id: u64) -> Value {
        let response = self.read().await;
        assert_eq!(response["id"], id);
        response
    }

    pub(crate) async fn finish_clean(mut self) {
        drop(self.child.stdin.take());
        let output = collect(self.child, self.stdout).await;
        assert!(output.status.success(), "MCP adapter must stop cleanly");
        assert!(output.stdout.is_empty());
        assert_audit_safe(&output.stderr);
    }

    pub(crate) async fn finish_after_core_close(self) {
        let output = collect(self.child, self.stdout).await;
        assert!(
            output.status.success() || output.stderr.contains(r#""code":"local_ipc_closed""#),
            "MCP adapter must stop cleanly or report local IPC closure"
        );
        assert!(output.stdout.is_empty());
        assert_audit_safe(&output.stderr);
    }

    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    async fn write(&mut self, value: Value) {
        let input = self.child.stdin.as_mut().expect("MCP stdin must be piped");
        input
            .write_all(&serde_json::to_vec(&value).unwrap())
            .await
            .expect("MCP request must be writable");
        input.write_all(b"\n").await.unwrap();
        input.flush().await.unwrap();
    }

    async fn read(&mut self) -> Value {
        let mut line = String::new();
        let bytes = timeout(TEST_TIMEOUT, self.stdout.read_line(&mut line))
            .await
            .expect("MCP response timed out")
            .expect("MCP response must be readable");
        assert!(bytes > 0, "MCP adapter closed before responding");
        serde_json::from_str(&line).expect("MCP stdout must contain JSON-RPC only")
    }
}

struct ProcessOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: String,
}

async fn collect(mut child: Child, mut stdout: BufReader<ChildStdout>) -> ProcessOutput {
    let mut stderr = child.stderr.take().expect("MCP stderr must be piped");
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
        .expect("MCP adapter did not stop")
        .expect("MCP adapter must be waitable");
    drop(child.stdin.take());
    ProcessOutput {
        status,
        stdout: stdout_task.await.unwrap(),
        stderr: String::from_utf8(stderr_task.await.unwrap()).unwrap(),
    }
}

fn assert_audit_safe(stderr: &str) {
    assert!(!stderr.contains("demo-process-test"));
    assert!(!stderr.contains("https://demo.mcpatch.invalid"));
    assert!(!stderr.contains("mcpatch.demo.status"));
    assert!(!stderr.is_empty());
    for line in stderr.lines() {
        let value: Value = serde_json::from_str(line).expect("MCP diagnostics must be JSON lines");
        assert_eq!(value["target"], "mcpatch");
        assert!(value["event"].is_string());
    }
}
