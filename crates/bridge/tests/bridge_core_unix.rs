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
    bridge_core::{BridgeCoreError, CoreStopReason, UnixBridgeCore},
    local_ipc::{EndpointRole, InstallChannel, UnixIpcErrorCode, UnixRuntime},
};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn start_owns_both_endpoints_and_rejects_a_second_core() {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();

    let first = UnixBridgeCore::start(runtime.clone()).await.unwrap();
    assert!(runtime.socket_path(EndpointRole::Browser).exists());
    assert!(runtime.socket_path(EndpointRole::Mcp).exists());

    let error = UnixBridgeCore::start(runtime.clone()).await.unwrap_err();
    assert_eq!(error.code(), "core_already_running");
    assert!(matches!(
        error,
        BridgeCoreError::Transport(error)
            if error.code() == UnixIpcErrorCode::CoreAlreadyRunning
    ));

    let first_epoch = first.epoch().clone();
    drop(first);
    assert!(!runtime.socket_path(EndpointRole::Browser).exists());
    assert!(!runtime.socket_path(EndpointRole::Mcp).exists());

    let restarted = UnixBridgeCore::start(runtime).await.unwrap();
    assert_ne!(restarted.epoch(), &first_epoch);
}

#[tokio::test]
async fn idle_core_stops_and_cleans_up_exact_endpoints() {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let core = UnixBridgeCore::start(runtime.clone()).await.unwrap();

    let reason = timeout(
        Duration::from_secs(1),
        core.run(Duration::from_millis(20), CancellationToken::new()),
    )
    .await
    .unwrap()
    .unwrap();

    assert_eq!(reason, CoreStopReason::Idle);
    assert!(!runtime.socket_path(EndpointRole::Browser).exists());
    assert!(!runtime.socket_path(EndpointRole::Mcp).exists());
}

#[tokio::test]
async fn authenticated_peers_defer_idle_shutdown_until_all_disconnect() {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let core = UnixBridgeCore::start(runtime.clone()).await.unwrap();
    let mut core_task = tokio::spawn(core.run(Duration::from_millis(30), CancellationToken::new()));
    let browser_client = runtime.connect(EndpointRole::Browser).await.unwrap();
    let mcp_client = runtime.connect(EndpointRole::Mcp).await.unwrap();

    tokio::time::sleep(Duration::from_millis(75)).await;
    assert!(!core_task.is_finished());

    drop(browser_client);
    tokio::time::sleep(Duration::from_millis(75)).await;
    assert!(!core_task.is_finished());

    drop(mcp_client);
    let reason = timeout(Duration::from_secs(1), &mut core_task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(reason, CoreStopReason::Idle);
}

#[tokio::test]
async fn shutdown_signal_stops_core_and_releases_ownership() {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let core = UnixBridgeCore::start(runtime.clone()).await.unwrap();
    let shutdown = CancellationToken::new();
    let core_task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));

    shutdown.cancel();
    let reason = timeout(Duration::from_secs(1), core_task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(reason, CoreStopReason::Shutdown);

    UnixBridgeCore::start(runtime).await.unwrap();
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
            "c{:x}{sequence:x}{:04x}",
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
