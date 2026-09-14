use std::{process::Stdio, time::Duration};

use mcpatch_bridge::native_host::{ALLOWED_EXTENSION_ORIGIN_ENV, MAX_NATIVE_MESSAGE_BYTES};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    time::timeout,
};

const PROCESS_TIMEOUT: Duration = Duration::from_secs(5);
const ALLOWED_ORIGIN: &str = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/";

#[tokio::test]
async fn authorized_host_stops_cleanly_on_eof_without_stdout_noise() {
    let child = spawn_native_host(ALLOWED_ORIGIN, ALLOWED_ORIGIN);
    let (status, stdout, stderr) = finish(child).await;

    assert!(status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""event":"native_host_started""#));
    assert!(stderr.contains(r#""event":"native_host_stopped""#));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn missing_origin_policy_fails_closed() {
    let child = Command::new(env!("CARGO_BIN_EXE_mcpatch"))
        .arg("native-host")
        .arg(ALLOWED_ORIGIN)
        .env_remove(ALLOWED_EXTENSION_ORIGIN_ENV)
        .env("MCPATCH_LOG", "trace")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("native host must spawn");
    let (status, stdout, stderr) = finish(child).await;

    assert!(!status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""code":"caller_origin_policy_unconfigured""#));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn rejects_unauthorized_caller_without_logging_the_origin() {
    let denied = "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/";
    let child = spawn_native_host(denied, ALLOWED_ORIGIN);
    let (status, stdout, stderr) = finish(child).await;

    assert!(!status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""code":"caller_origin_unauthorized""#));
    assert!(!stderr.contains(denied));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn malformed_frame_terminates_without_echoing_payload() {
    let mut child = spawn_native_host(ALLOWED_ORIGIN, ALLOWED_ORIGIN);
    let marker = b"private-browser-payload";
    let mut frame = u32::try_from(marker.len()).unwrap().to_ne_bytes().to_vec();
    frame.extend_from_slice(marker);
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&frame)
        .await
        .unwrap();

    let (status, stdout, stderr) = finish(child).await;
    assert!(!status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""code":"native_message_invalid_protocol""#));
    assert!(!stderr.contains("private-browser-payload"));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn oversized_prefix_is_rejected_without_reading_a_payload() {
    let mut child = spawn_native_host(ALLOWED_ORIGIN, ALLOWED_ORIGIN);
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(
            &u32::try_from(MAX_NATIVE_MESSAGE_BYTES + 1)
                .unwrap()
                .to_ne_bytes(),
        )
        .await
        .unwrap();

    let (status, stdout, stderr) = finish(child).await;
    assert!(!status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""code":"native_message_too_large""#));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn valid_message_fails_closed_while_local_ipc_is_unavailable() {
    let mut child = spawn_native_host(ALLOWED_ORIGIN, ALLOWED_ORIGIN);
    let payload = serde_json::to_vec(&json!({
        "type": "heartbeat",
        "protocolVersion": 1,
        "heartbeatId": "private-heartbeat-marker",
        "sentAt": "2026-09-15T00:00:00Z"
    }))
    .unwrap();
    let mut frame = u32::try_from(payload.len()).unwrap().to_ne_bytes().to_vec();
    frame.extend_from_slice(&payload);
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&frame)
        .await
        .unwrap();

    let (status, stdout, stderr) = finish(child).await;
    assert!(!status.success());
    assert!(stdout.is_empty());
    assert!(stderr.contains(r#""code":"local_ipc_unavailable""#));
    assert!(!stderr.contains("private-heartbeat-marker"));
    assert_json_lines(&stderr);
}

fn spawn_native_host(caller: &str, allowed: &str) -> Child {
    Command::new(env!("CARGO_BIN_EXE_mcpatch"))
        .arg("native-host")
        .arg(caller)
        .env(ALLOWED_EXTENSION_ORIGIN_ENV, allowed)
        .env("RUST_LOG", "trace")
        .env("MCPATCH_LOG", "trace")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("native host must spawn")
}

async fn finish(mut child: Child) -> (std::process::ExitStatus, Vec<u8>, String) {
    drop(child.stdin.take());
    let mut stdout = child.stdout.take().expect("stdout must be piped");
    let mut stderr = child.stderr.take().expect("stderr must be piped");
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

    let status = timeout(PROCESS_TIMEOUT, child.wait())
        .await
        .expect("native host timed out")
        .expect("native host must be waitable");
    let stdout = stdout_task.await.unwrap();
    let stderr = String::from_utf8(stderr_task.await.unwrap()).unwrap();
    (status, stdout, stderr)
}

fn assert_json_lines(stderr: &str) {
    assert!(!stderr.is_empty());
    for line in stderr.lines() {
        let value: Value = serde_json::from_str(line).expect("stderr lines must be JSON");
        assert_eq!(value["target"], "mcpatch");
        assert!(value["event"].is_string());
    }
}
