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
    protocol::{
        ContextClosed, ContextClosedReason, Hello, Implementation, Message, PROTOCOL_VERSION,
        Permission, Risk, Role, parse_message,
    },
};
use serde_json::{Value, json};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

const DEMO_SNAPSHOT: &[u8] =
    include_bytes!("../../../packages/protocol/fixtures/v1/valid/demo-capability-snapshot.json");

#[tokio::test]
async fn core_lists_only_the_live_browser_capability_contract() {
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
    initialize_mcp(&mut mcp, 30).await;
    assert_cursor_is_rejected(&mut mcp, 31).await;
    let tools = wait_for_tool_count(&mut mcp, 32, 1).await;
    assert_public_demo_contract(&tools[0]);

    let Message::CapabilitySnapshot(mut snapshot) = parse_message(DEMO_SNAPSHOT).unwrap() else {
        panic!("demo fixture must contain a capability snapshot");
    };
    snapshot.context_revision = 2;
    let mut alphabetic_first = snapshot.capabilities[0].clone();
    alphabetic_first.name = "aaa.demo.status".to_owned();
    let mut denied = snapshot.capabilities[0].clone();
    denied.name = "mcpatch.demo.denied".to_owned();
    denied.risk = Risk::Sensitive;
    denied.permissions = vec![Permission::Sensitive, Permission::Credential];
    snapshot.capabilities.push(alphabetic_first);
    snapshot.capabilities.push(denied);
    browser
        .write_json(&serde_json::to_vec(&Message::CapabilitySnapshot(snapshot.clone())).unwrap())
        .await
        .unwrap();
    let tools = wait_for_tool_count(&mut mcp, 50, 2).await;
    assert_eq!(
        tool_names(&tools),
        ["aaa.demo.status", "mcpatch.demo.status"]
    );

    let mut conflicting_browser = runtime.connect(EndpointRole::Browser).await.unwrap();
    negotiate_browser(&mut conflicting_browser).await;
    conflicting_browser.write_json(DEMO_SNAPSHOT).await.unwrap();
    let tools = wait_for_tool_count(&mut mcp, 60, 1).await;
    assert_eq!(tool_names(&tools), ["aaa.demo.status"]);

    drop(conflicting_browser);
    let tools = wait_for_tool_count(&mut mcp, 70, 2).await;
    assert_eq!(
        tool_names(&tools),
        ["aaa.demo.status", "mcpatch.demo.status"]
    );

    browser
        .write_json(
            &serde_json::to_vec(&Message::ContextClosed(ContextClosed {
                protocol_version: PROTOCOL_VERSION,
                context_id: snapshot.context_id,
                context_revision: snapshot.context_revision,
                reason: ContextClosedReason::Disconnected,
            }))
            .unwrap(),
        )
        .await
        .unwrap();
    wait_for_tool_count(&mut mcp, 80, 0).await;

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

fn assert_public_demo_contract(tool: &Value) {
    assert_eq!(tool["name"], "mcpatch.demo.status");
    assert_eq!(tool["title"], "MCPatch demo status");
    assert_eq!(tool["inputSchema"]["maxProperties"], 0);
    assert_eq!(tool["outputSchema"]["required"], json!(["status"]));
    assert_eq!(tool["annotations"]["readOnlyHint"], true);
    assert!(tool.get("_meta").is_none());
}

fn tool_names(tools: &[Value]) -> Vec<&str> {
    tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect()
}

async fn initialize_mcp(stream: &mut AuthenticatedUnixStream, id: u64) {
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "tool-discovery-test", "version": "0.1.0"}
        }
    });
    stream
        .write_json(&serde_json::to_vec(&initialize).unwrap())
        .await
        .unwrap();
    let response = read_response(stream).await;
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
}

async fn list_tools(stream: &mut AuthenticatedUnixStream, id: u64) -> Vec<Value> {
    let request = json!({"jsonrpc": "2.0", "id": id, "method": "tools/list", "params": {}});
    stream
        .write_json(&serde_json::to_vec(&request).unwrap())
        .await
        .unwrap();
    let response = read_response(stream).await;
    assert_eq!(response["id"], id);
    response["result"]["tools"].as_array().unwrap().clone()
}

async fn assert_cursor_is_rejected(stream: &mut AuthenticatedUnixStream, id: u64) {
    let request = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/list",
        "params": {"cursor": "unrecognized"}
    });
    stream
        .write_json(&serde_json::to_vec(&request).unwrap())
        .await
        .unwrap();
    let response = read_response(stream).await;
    assert_eq!(response["id"], id);
    assert_eq!(response["error"]["code"], -32602);
    assert!(response["error"].get("data").is_none());
}

async fn wait_for_tool_count(
    stream: &mut AuthenticatedUnixStream,
    first_id: u64,
    expected: usize,
) -> Vec<Value> {
    timeout(Duration::from_secs(2), async {
        for offset in 0..100 {
            let tools = list_tools(stream, first_id + offset).await;
            if tools.len() == expected {
                return tools;
            }
            tokio::task::yield_now().await;
        }
        panic!("tool count did not converge to {expected}");
    })
    .await
    .unwrap()
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
        parse_message(&read_response_bytes(stream).await).unwrap(),
        Message::HelloAck(_)
    ));
}

async fn read_response(stream: &mut AuthenticatedUnixStream) -> Value {
    serde_json::from_slice(&read_response_bytes(stream).await).unwrap()
}

async fn read_response_bytes(stream: &mut AuthenticatedUnixStream) -> Vec<u8> {
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
