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
    local_ipc::{
        AuthenticatedUnixStream, EndpointRole, InstallChannel, UnixIpcErrorCode, UnixRuntime,
    },
    protocol::{Hello, Implementation, Message, PROTOCOL_VERSION, Role, parse_message},
};
use serde_json::{Value, json};
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

#[tokio::test]
async fn core_owns_multiple_independent_mcp_sessions() {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let core = UnixBridgeCore::start(runtime.clone()).await.unwrap();
    let shutdown = CancellationToken::new();
    let core_task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
    let mut first = runtime.connect(EndpointRole::Mcp).await.unwrap();
    let mut second = runtime.connect(EndpointRole::Mcp).await.unwrap();

    initialize_and_list_tools(&mut first, 1).await;
    initialize_and_list_tools(&mut second, 11).await;

    drop(first);
    drop(second);
    shutdown.cancel();
    assert_eq!(
        timeout(Duration::from_secs(2), core_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        CoreStopReason::Shutdown
    );
}

#[tokio::test]
async fn initialized_mcp_disconnect_starts_idle_grace_without_stopping_the_core() {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let core = UnixBridgeCore::start(runtime.clone()).await.unwrap();
    let core_task = tokio::spawn(core.run(Duration::from_millis(30), CancellationToken::new()));
    let mut client = runtime.connect(EndpointRole::Mcp).await.unwrap();

    initialize_and_list_tools(&mut client, 1).await;
    drop(client);

    assert_eq!(
        timeout(Duration::from_secs(1), core_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        CoreStopReason::Idle
    );
}

#[tokio::test]
async fn browser_endpoint_negotiates_before_serving_the_session() {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let core = UnixBridgeCore::start(runtime.clone()).await.unwrap();
    let private_epoch = core.epoch().as_str().to_owned();
    let shutdown = CancellationToken::new();
    let core_task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
    let mut browser = runtime.connect(EndpointRole::Browser).await.unwrap();

    browser
        .write_json(&serde_json::to_vec(&browser_hello()).unwrap())
        .await
        .unwrap();
    let payload = timeout(Duration::from_secs(2), browser.read_json())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let Message::HelloAck(acknowledgement) = parse_message(&payload).unwrap() else {
        panic!("browser session must return hello_ack");
    };
    assert_eq!(acknowledgement.selected_protocol_version, PROTOCOL_VERSION);
    assert!(acknowledgement.connection_id.starts_with("browser."));
    assert!(!acknowledgement.connection_id.contains(&private_epoch));

    drop(browser);
    shutdown.cancel();
    assert_eq!(
        timeout(Duration::from_secs(2), core_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        CoreStopReason::Shutdown
    );
}

#[tokio::test]
async fn core_bounds_sessions_per_parser_role() {
    const SESSION_LIMIT: usize = 8;
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let core = UnixBridgeCore::start(runtime.clone()).await.unwrap();
    let shutdown = CancellationToken::new();
    let core_task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
    let mut retained = Vec::with_capacity(SESSION_LIMIT);
    for _ in 0..SESSION_LIMIT {
        retained.push(runtime.connect(EndpointRole::Browser).await.unwrap());
    }
    tokio::time::sleep(Duration::from_millis(20)).await;

    let mut rejected = runtime.connect(EndpointRole::Browser).await.unwrap();
    assert_eq!(
        timeout(Duration::from_secs(1), rejected.read_json())
            .await
            .unwrap()
            .unwrap(),
        None
    );

    drop(retained);
    shutdown.cancel();
    assert_eq!(
        timeout(Duration::from_secs(2), core_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        CoreStopReason::Shutdown
    );
}

async fn initialize_and_list_tools(stream: &mut AuthenticatedUnixStream, id: u64) {
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "core-session-test", "version": "0.1.0"}
        }
    });
    stream
        .write_json(&serde_json::to_vec(&initialize).unwrap())
        .await
        .unwrap();
    let response: Value = serde_json::from_slice(
        &timeout(Duration::from_secs(2), stream.read_json())
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(response["id"], id);
    assert_eq!(response["result"]["serverInfo"]["name"], "mcpatch");

    let initialized = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    });
    stream
        .write_json(&serde_json::to_vec(&initialized).unwrap())
        .await
        .unwrap();
    let list_id = id + 1;
    let list = json!({"jsonrpc": "2.0", "id": list_id, "method": "tools/list", "params": {}});
    stream
        .write_json(&serde_json::to_vec(&list).unwrap())
        .await
        .unwrap();
    let response: Value = serde_json::from_slice(
        &timeout(Duration::from_secs(2), stream.read_json())
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(response["id"], list_id);
    assert_eq!(response["result"]["tools"], json!([]));
}

fn browser_hello() -> Message {
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
