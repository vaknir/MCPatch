use std::{process::Stdio, time::Duration};

use mcpatch_bridge::mcp::MAX_MCP_MESSAGE_BYTES;
use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    time::timeout,
};

const PROCESS_TIMEOUT: Duration = Duration::from_secs(5);

#[tokio::test]
async fn initializes_lists_no_tools_and_keeps_logs_off_stdout() {
    let mut child = spawn_bridge();
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout must be piped"));

    write_json_line(
        &mut child,
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"integration-secret-marker","version":"0.1.0"}}}"#,
    )
    .await;

    let initialize = read_json_line(&mut stdout).await;
    assert_eq!(initialize["id"], 1);
    assert_eq!(initialize["result"]["protocolVersion"], "2025-11-25");
    assert_eq!(initialize["result"]["serverInfo"]["name"], "mcpatch");
    assert!(initialize["result"]["capabilities"]["tools"].is_object());

    write_json_line(
        &mut child,
        r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#,
    )
    .await;
    write_json_line(
        &mut child,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#,
    )
    .await;

    let tools = read_json_line(&mut stdout).await;
    assert_eq!(tools["id"], 2);
    assert_eq!(tools["result"]["tools"], serde_json::json!([]));

    let (status, trailing_stdout, stderr) = finish(child).await;
    assert!(status.success());
    assert!(trailing_stdout.is_empty());
    assert!(!stderr.contains("integration-secret-marker"));
    assert!(!stderr.contains("initialize"));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn rejects_oversized_input_without_echoing_it() {
    let mut child = spawn_bridge();
    let mut frame = vec![b'x'; MAX_MCP_MESSAGE_BYTES + 1];
    frame.push(b'\n');

    child
        .stdin
        .as_mut()
        .expect("stdin must be piped")
        .write_all(&frame)
        .await
        .expect("oversized input must be writable");

    let (status, stdout, stderr) = finish(child).await;
    assert!(!status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""event":"mcp_stdio_failed""#));
    assert!(stderr.contains(r#""code":"mcp_stdio_message_too_large""#));
    assert!(
        stderr.len() < 16 * 1024,
        "logs must not echo rejected input"
    );
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn rejects_malformed_input_without_starting_a_session() {
    let mut child = spawn_bridge();
    write_json_line(&mut child, r#"{"jsonrpc":"2.0","id":1,"id":2}"#).await;

    let (status, stdout, stderr) = finish(child).await;
    assert!(!status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""event":"mcp_stdio_failed""#));
    assert!(stderr.contains(r#""code":"mcp_stdio_invalid_message""#));
    assert!(!stderr.contains(r#""id":1"#));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn clean_initial_eof_exits_without_stdout_noise() {
    let child = spawn_bridge();
    let (status, stdout, stderr) = finish(child).await;
    assert!(status.success());
    assert!(stdout.is_empty());
    assert!(!stderr.contains("mcp_client_ready"));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn version_command_does_not_start_the_runtime() {
    let output = timeout(
        PROCESS_TIMEOUT,
        Command::new(env!("CARGO_BIN_EXE_mcpatch"))
            .arg("--version")
            .output(),
    )
    .await
    .expect("version command timed out")
    .expect("version command must run");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).expect("stdout must be UTF-8"),
        format!("mcpatch {}\n", env!("CARGO_PKG_VERSION"))
    );
    assert!(output.stderr.is_empty());
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn reports_missing_runtime_directory_with_an_operator_hint() {
    let mut child = bridge_command()
        .env_remove("XDG_RUNTIME_DIR")
        .env_remove("MCPATCH_RUNTIME_DIR")
        .spawn()
        .expect("bridge must spawn");
    write_json_line(
        &mut child,
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"secret-client-marker","version":"0.1.0"}}}"#,
    )
    .await;

    let (status, stdout, stderr) = finish(child).await;
    assert!(!status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""event":"mcp_stdio_failed""#));
    assert!(stderr.contains(r#""code":"local_core_runtime_directory_unavailable""#));
    assert!(stderr.contains(r#""hint":"#));
    assert!(stderr.contains("XDG_RUNTIME_DIR"));
    assert!(stderr.contains("MCPATCH_RUNTIME_DIR"));
    assert!(!stderr.contains("secret-client-marker"));
    assert!(!stderr.contains('/'), "hints must never carry paths");
    assert_json_lines(&stderr);
}

fn spawn_bridge() -> Child {
    bridge_command().spawn().expect("bridge must spawn")
}

/// Every spawned bridge gets a private runtime directory so the suite does not
/// depend on a login session exporting `XDG_RUNTIME_DIR`.
fn bridge_command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_mcpatch"));
    command
        .arg("mcp-stdio")
        .env("RUST_LOG", "trace")
        .env("MCPATCH_LOG", "trace")
        .env("MCPATCH_RUNTIME_DIR", private_runtime_directory())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

fn private_runtime_directory() -> &'static std::path::Path {
    static DIRECTORY: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    DIRECTORY.get_or_init(|| {
        let path = std::env::temp_dir().join(format!("mcpatch-stdio-{}", std::process::id()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&path)
                .expect("private runtime directory must be creatable");
        }
        #[cfg(not(unix))]
        std::fs::create_dir(&path).expect("runtime directory must be creatable");
        path
    })
}

async fn write_json_line(child: &mut Child, line: &str) {
    let stdin = child.stdin.as_mut().expect("stdin must be piped");
    stdin
        .write_all(line.as_bytes())
        .await
        .expect("JSON-RPC message must be writable");
    stdin
        .write_all(b"\n")
        .await
        .expect("newline must be writable");
    stdin.flush().await.expect("stdin must flush");
}

async fn read_json_line<R>(reader: &mut BufReader<R>) -> Value
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut line = String::new();
    let bytes = timeout(PROCESS_TIMEOUT, reader.read_line(&mut line))
        .await
        .expect("bridge response timed out")
        .expect("bridge response must be readable");
    assert!(bytes > 0, "bridge closed stdout before responding");
    serde_json::from_str(&line).expect("stdout must contain JSON-RPC only")
}

async fn finish(mut child: Child) -> (std::process::ExitStatus, Vec<u8>, String) {
    drop(child.stdin.take());
    let stdout = child.stdout.take();
    let mut stderr = child.stderr.take().expect("stderr must be piped");
    let stdout_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        if let Some(mut stdout) = stdout {
            stdout
                .read_to_end(&mut bytes)
                .await
                .expect("stdout must be readable");
        }
        bytes
    });
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr
            .read_to_end(&mut bytes)
            .await
            .expect("stderr must be readable");
        bytes
    });

    let status = timeout(PROCESS_TIMEOUT, child.wait())
        .await
        .expect("bridge did not stop after EOF")
        .expect("bridge must be waitable");
    let stdout = stdout_task.await.expect("stdout task must complete");
    let stderr = stderr_task.await.expect("stderr task must complete");
    (
        status,
        stdout,
        String::from_utf8(stderr).expect("structured logs must be UTF-8"),
    )
}

fn assert_json_lines(stderr: &str) {
    assert!(!stderr.is_empty());
    for line in stderr.lines() {
        let value: Value = serde_json::from_str(line).expect("stderr lines must be JSON");
        assert_eq!(value["target"], "mcpatch");
        assert!(value["event"].is_string());
    }
}
