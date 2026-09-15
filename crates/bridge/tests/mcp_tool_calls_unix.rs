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
    bridge_core::{CoreStopReason, UnixBridgeCore},
    local_ipc::{AuthenticatedUnixStream, EndpointRole, InstallChannel, UnixRuntime},
    protocol::{Hello, Implementation, Message, PROTOCOL_VERSION, Role, ToolResult, parse_message},
};
use serde_json::{Value, json};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

const DEMO_SNAPSHOT: &[u8] =
    include_bytes!("../../../packages/protocol/fixtures/v1/valid/demo-capability-snapshot.json");

#[tokio::test]
async fn core_routes_a_tool_call_and_returns_only_the_validated_result() {
    let fixture = TestDirectory::new();
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let core = UnixBridgeCore::start(runtime.clone()).await.unwrap();
    let shutdown = CancellationToken::new();
    let core_task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));

    let mut browser = runtime.connect(EndpointRole::Browser).await.unwrap();
    negotiate_browser(&mut browser).await;
    browser.write_json(DEMO_SNAPSHOT).await.unwrap();

    let mut mcp = runtime.connect(EndpointRole::Mcp).await.unwrap();
    initialize_mcp(&mut mcp, 10).await;
    wait_for_demo_tool(&mut mcp).await;

    let request = json!({
        "jsonrpc": "2.0",
        "id": 20,
        "method": "tools/call",
        "params": {"name": "mcpatch.demo.status", "arguments": {}}
    });
    mcp.write_json(&serde_json::to_vec(&request).unwrap())
        .await
        .unwrap();

    let Message::ToolCall(call) = read_browser_message(&mut browser).await else {
        panic!("browser must receive a tool call");
    };
    assert_eq!(call.tool, "mcpatch.demo.status");
    assert_eq!(call.context_id, "mcpatch.demo");
    assert_eq!(call.context_revision, 1);
    assert_eq!(call.origin, "https://demo.mcpatch.invalid");
    assert!(call.args.is_empty());

    let result = Message::ToolResult(ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: call.request_id,
        context_id: call.context_id,
        context_revision: call.context_revision,
        origin: call.origin,
        result: json!({"status": "ready"}),
    });
    browser
        .write_json(&serde_json::to_vec(&result).unwrap())
        .await
        .unwrap();

    let response = read_mcp_response(&mut mcp).await;
    assert_eq!(response["id"], 20);
    assert_eq!(
        response["result"]["structuredContent"],
        json!({"status": "ready"})
    );
    assert!(response["result"].get("_meta").is_none());

    drop(mcp);
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

async fn initialize_mcp(stream: &mut AuthenticatedUnixStream, id: u64) {
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "tool-call-test", "version": "0.1.0"}
        }
    });
    stream
        .write_json(&serde_json::to_vec(&initialize).unwrap())
        .await
        .unwrap();
    let response = read_mcp_response(stream).await;
    assert_eq!(response["id"], id);

    let initialized = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    });
    stream
        .write_json(&serde_json::to_vec(&initialized).unwrap())
        .await
        .unwrap();
}

async fn wait_for_demo_tool(stream: &mut AuthenticatedUnixStream) {
    timeout(Duration::from_secs(2), async {
        for id in 100..200 {
            let request = json!({"jsonrpc": "2.0", "id": id, "method": "tools/list", "params": {}});
            stream
                .write_json(&serde_json::to_vec(&request).unwrap())
                .await
                .unwrap();
            let response = read_mcp_response(stream).await;
            if response["result"]["tools"]
                .as_array()
                .is_some_and(|tools| tools.len() == 1)
            {
                return;
            }
            tokio::task::yield_now().await;
        }
        panic!("demo tool did not become visible");
    })
    .await
    .unwrap();
}

async fn negotiate_browser(stream: &mut AuthenticatedUnixStream) {
    let hello = Message::Hello(Hello {
        protocol_version: PROTOCOL_VERSION,
        role: Role::Extension,
        supported_protocol_versions: vec![PROTOCOL_VERSION],
        implementation: Implementation {
            name: "mcpatch-extension".to_owned(),
            version: "0.1.0".to_owned(),
        },
    });
    stream
        .write_json(&serde_json::to_vec(&hello).unwrap())
        .await
        .unwrap();
    assert!(matches!(
        read_browser_message(stream).await,
        Message::HelloAck(_)
    ));
}

async fn read_browser_message(stream: &mut AuthenticatedUnixStream) -> Message {
    parse_message(&read_bytes(stream).await).unwrap()
}

async fn read_mcp_response(stream: &mut AuthenticatedUnixStream) -> Value {
    serde_json::from_slice(&read_bytes(stream).await).unwrap()
}

async fn read_bytes(stream: &mut AuthenticatedUnixStream) -> Vec<u8> {
    timeout(Duration::from_secs(2), stream.read_json())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
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
