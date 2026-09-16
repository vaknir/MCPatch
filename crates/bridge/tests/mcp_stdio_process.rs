mod stdio_support;

use std::time::Duration;

use mcpatch_bridge::mcp::MAX_MCP_MESSAGE_BYTES;
use stdio_support::{
    assert_json_lines, bridge_command as command_for, finish, read_json_line, write_json_line,
};
use tokio::{
    io::{AsyncWriteExt, BufReader},
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
    command_for(private_runtime_directory())
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
