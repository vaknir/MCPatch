//! Drives the real `mcpatch mcp-stdio` executable the way an MCP client does.
#![allow(dead_code)]

use std::{
    fs,
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    time::timeout,
};

pub(crate) const PROCESS_TIMEOUT: Duration = Duration::from_secs(5);

/// The adapter command with logging at its most verbose, so every assertion
/// about what stays out of stderr holds at the noisiest level an operator can
/// configure.
pub(crate) fn bridge_command(runtime_directory: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_mcpatch"));
    command
        .arg("mcp-stdio")
        .env("RUST_LOG", "trace")
        .env("MCPATCH_LOG", "trace")
        .env("MCPATCH_RUNTIME_DIR", runtime_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

pub(crate) async fn write_json_line(child: &mut Child, line: &str) {
    write_bytes(child, line.as_bytes()).await;
    write_bytes(child, b"\n").await;
}

pub(crate) async fn write_bytes(child: &mut Child, bytes: &[u8]) {
    let stdin = child.stdin.as_mut().expect("stdin must be piped");
    stdin
        .write_all(bytes)
        .await
        .expect("bridge input must be writable");
    stdin.flush().await.expect("stdin must flush");
}

/// Write input the bridge is expected to reject part-way through: once it
/// closes stdin the rest of the write fails with a broken pipe, which is the
/// behavior under test rather than a harness failure.
pub(crate) async fn write_bytes_until_closed(child: &mut Child, bytes: &[u8]) {
    let stdin = child.stdin.as_mut().expect("stdin must be piped");
    match stdin.write_all(bytes).await.and(stdin.flush().await) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => {}
        Err(error) => panic!("bridge input must be writable: {error}"),
    }
}

pub(crate) async fn read_json_line<R>(reader: &mut BufReader<R>) -> Value
where
    R: AsyncRead + Unpin,
{
    let mut line = String::new();
    let bytes = timeout(PROCESS_TIMEOUT, reader.read_line(&mut line))
        .await
        .expect("bridge response timed out")
        .expect("bridge response must be readable");
    assert!(bytes > 0, "bridge closed stdout before responding");
    serde_json::from_str(&line).expect("stdout must contain JSON-RPC only")
}

/// Close stdin, wait for exit, and return the status with everything the
/// process still wrote to stdout and stderr.
pub(crate) async fn finish(mut child: Child) -> (ExitStatus, Vec<u8>, String) {
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

pub(crate) fn assert_json_lines(stderr: &str) {
    assert!(!stderr.is_empty());
    for line in stderr.lines() {
        let value: Value = serde_json::from_str(line).expect("stderr lines must be JSON");
        assert_eq!(value["target"], "mcpatch");
        assert!(value["event"].is_string());
    }
}

static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

/// A private runtime base directory that lives for one test, so every test
/// elects its own bridge core and never shares a registry with another.
pub(crate) struct TestDirectory(PathBuf);

impl TestDirectory {
    pub(crate) fn new() -> Self {
        let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .subsec_nanos();
        let path = std::env::temp_dir().join(format!(
            "s{:x}{sequence:x}{:04x}",
            std::process::id(),
            timestamp & 0xffff
        ));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&path)
            .expect("private runtime directory must be creatable");
        Self(path)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
