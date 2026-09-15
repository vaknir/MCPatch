#![cfg(unix)]

use std::{
    fs::{self, DirBuilder},
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use mcpatch_bridge::{
    local_ipc::{
        AuthenticatedUnixStream, CoreRendezvousError, EndpointRole, InstallChannel,
        LocalCoreConnection, LocalRuntime, UnixCoreElection, UnixEndpointListener, UnixRuntime,
    },
    mcp::{BridgeRuntimeError, McpStdioFrameErrorCode, run},
};
use tokio::{
    io::{AsyncReadExt, AsyncWrite, AsyncWriteExt},
    time::timeout,
};

const TEST_TIMEOUT: Duration = Duration::from_secs(2);
const INITIALIZE: &[u8] = br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"adapter-test","version":"0.1.0"}}}"#;

#[tokio::test]
async fn stdio_eof_closes_the_authenticated_local_session() {
    let (connection, mut core, _election, _listener, _fixture) = connection_pair().await;
    let (mut client_input, host_input) = tokio::io::duplex(4096);
    let runtime = tokio::spawn(run(host_input, tokio::io::sink(), || async move {
        Ok::<_, CoreRendezvousError>(connection)
    }));

    write_line(&mut client_input, INITIALIZE).await;
    assert_eq!(core.read_json().await.unwrap(), Some(INITIALIZE.to_vec()));
    drop(client_input);

    timeout(TEST_TIMEOUT, runtime)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        timeout(TEST_TIMEOUT, core.read_json())
            .await
            .unwrap()
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn local_eof_closes_stdio_promptly() {
    let (connection, mut core, _election, _listener, _fixture) = connection_pair().await;
    let (mut client_input, host_input) = tokio::io::duplex(4096);
    let (host_output, mut client_output) = tokio::io::duplex(4096);
    let runtime = tokio::spawn(run(host_input, host_output, || async move {
        Ok::<_, CoreRendezvousError>(connection)
    }));

    write_line(&mut client_input, INITIALIZE).await;
    assert!(core.read_json().await.unwrap().is_some());
    drop(core);

    timeout(TEST_TIMEOUT, runtime)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let mut byte = [0_u8; 1];
    assert_eq!(
        timeout(TEST_TIMEOUT, client_output.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn malformed_stdio_after_connect_closes_local_ipc() {
    let (connection, mut core, _election, _listener, _fixture) = connection_pair().await;
    let (mut client_input, host_input) = tokio::io::duplex(4096);
    let runtime = tokio::spawn(run(host_input, tokio::io::sink(), || async move {
        Ok::<_, CoreRendezvousError>(connection)
    }));

    write_line(&mut client_input, INITIALIZE).await;
    assert!(core.read_json().await.unwrap().is_some());
    write_line(&mut client_input, br#"{"id":1,"id":2}"#).await;

    let error = timeout(TEST_TIMEOUT, runtime)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert!(matches!(
        error,
        BridgeRuntimeError::Stdio(error)
            if error.code() == McpStdioFrameErrorCode::InvalidMessage
    ));
    assert_eq!(
        timeout(TEST_TIMEOUT, core.read_json())
            .await
            .unwrap()
            .unwrap(),
        None
    );
}

async fn connection_pair() -> (
    LocalCoreConnection,
    AuthenticatedUnixStream,
    UnixCoreElection,
    UnixEndpointListener,
    TestDirectory,
) {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let election = runtime.try_elect_core().unwrap();
    let listener = runtime
        .bind_after_election(&election, EndpointRole::Mcp)
        .await
        .unwrap();
    let adapter_runtime = LocalRuntime::from(runtime);
    let connect = tokio::spawn(async move { adapter_runtime.connect(EndpointRole::Mcp).await });
    let core = listener.accept_authenticated().await.unwrap();
    let connection = connect.await.unwrap().unwrap();
    (connection, core, election, listener, fixture)
}

async fn write_line(writer: &mut (impl AsyncWrite + Unpin), payload: &[u8]) {
    writer.write_all(payload).await.unwrap();
    writer.write_all(b"\n").await.unwrap();
    writer.flush().await.unwrap();
}

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
            "m{:x}{sequence:x}{:04x}",
            process::id(),
            timestamp & 0xffff
        ));
        let mut builder = DirBuilder::new();
        builder.mode(0o700).create(&path).unwrap();
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
