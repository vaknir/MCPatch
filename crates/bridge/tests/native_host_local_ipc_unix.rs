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
    local_ipc::{EndpointRole, InstallChannel, LocalRuntime, UnixRuntime},
    native_host::{CoreLocalBrowserChannel, LocalBrowserChannel, LocalBrowserChannelErrorCode},
    protocol::{Heartbeat, Message, PROTOCOL_VERSION, parse_message},
};
use tokio::time::timeout;

const TEST_TIMEOUT: Duration = Duration::from_secs(2);

#[tokio::test]
async fn authenticated_channel_relays_one_typed_message_each_way() {
    let (channel, mut core_peer, _listener, _fixture) = connected_channel().await;

    let from_browser = heartbeat("from-browser");
    channel.send(from_browser.clone()).await.unwrap();
    let payload = timeout(TEST_TIMEOUT, core_peer.read_json())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(parse_message(&payload).unwrap(), from_browser);

    let to_browser = heartbeat("to-browser");
    core_peer
        .write_json(&serde_json::to_vec(&to_browser).unwrap())
        .await
        .unwrap();
    assert_eq!(
        timeout(TEST_TIMEOUT, channel.receive())
            .await
            .unwrap()
            .unwrap(),
        Some(to_browser)
    );

    channel.close().await.unwrap();
    assert_eq!(
        timeout(TEST_TIMEOUT, core_peer.read_json())
            .await
            .unwrap()
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn authenticated_channel_reports_core_eof_and_malformed_protocol() {
    let (closed_channel, core_peer, _listener, _fixture) = connected_channel().await;
    drop(core_peer);
    let error = timeout(TEST_TIMEOUT, closed_channel.receive())
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code(), LocalBrowserChannelErrorCode::Closed);
    closed_channel.close().await.unwrap();

    let (malformed_channel, mut core_peer, _listener, _fixture) = connected_channel().await;
    core_peer.write_json(br#"{}"#).await.unwrap();
    let error = timeout(TEST_TIMEOUT, malformed_channel.receive())
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code(), LocalBrowserChannelErrorCode::Malformed);
    malformed_channel.close().await.unwrap();
}

async fn connected_channel() -> (
    std::sync::Arc<CoreLocalBrowserChannel>,
    mcpatch_bridge::local_ipc::AuthenticatedUnixStream,
    mcpatch_bridge::local_ipc::UnixEndpointListener,
    TestDirectory,
) {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let listener = runtime
        .bind_after_election(EndpointRole::Browser)
        .await
        .unwrap();
    let adapter_runtime = LocalRuntime::from(runtime);
    let connect = tokio::spawn(async move { adapter_runtime.connect(EndpointRole::Browser).await });
    let core_peer = listener.accept_authenticated().await.unwrap();
    let connection = connect.await.unwrap().unwrap();

    (
        CoreLocalBrowserChannel::new(connection),
        core_peer,
        listener,
        fixture,
    )
}

fn heartbeat(id: &str) -> Message {
    Message::Heartbeat(Heartbeat {
        protocol_version: PROTOCOL_VERSION,
        heartbeat_id: id.into(),
        sent_at: "2026-09-15T00:00:00Z".into(),
    })
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
            "n{:x}{sequence:x}{:04x}",
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
