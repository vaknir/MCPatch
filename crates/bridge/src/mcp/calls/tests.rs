use std::{num::NonZeroUsize, time::Duration};

use rmcp::model::{CallToolRequestParams, CallToolResponse, ErrorCode as McpErrorCode};
use serde_json::{Map, Value, json};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use super::McpCallRuntime;
use crate::{
    browser::{BrowserConnection, BrowserConnectionId, FakeBrowserPeer, fake_browser_connection},
    protocol::{ErrorCode, Message, Permission, Risk, ToolError, ToolResult, parse_message},
    routing::{BrowserToolResponse, SharedCapabilityRegistry, shared_capability_registry},
};

const TEST_TIMEOUT: Duration = Duration::from_secs(1);

#[tokio::test]
async fn returns_only_the_exact_validated_browser_result() {
    let fixture = fixture(Duration::from_millis(100)).await;
    let task = spawn_call(&fixture.runtime, CancellationToken::new(), Map::new());
    let call = receive_call(&fixture.browser).await;
    assert!(call.request_id.starts_with("mcp."));
    assert_eq!(call.context_id, "mcpatch.demo");
    assert_eq!(call.origin, "https://demo.mcpatch.invalid");
    assert_eq!(call.tool, "mcpatch.demo.status");

    fixture
        .registry
        .lock()
        .await
        .accept_response(
            &fixture.connection_id,
            BrowserToolResponse::Result(ToolResult {
                protocol_version: call.protocol_version,
                request_id: call.request_id,
                context_id: call.context_id,
                context_revision: call.context_revision,
                origin: call.origin,
                result: json!({"status": "ready"}),
            }),
        )
        .unwrap();

    let result = complete(task).await;
    assert_eq!(result.structured_content, Some(json!({"status": "ready"})));
    assert_eq!(result.is_error, Some(false));
}

#[tokio::test]
async fn returns_a_typed_browser_error_without_changing_its_route() {
    let fixture = fixture(Duration::from_millis(100)).await;
    let task = spawn_call(&fixture.runtime, CancellationToken::new(), Map::new());
    let call = receive_call(&fixture.browser).await;
    fixture
        .registry
        .lock()
        .await
        .accept_response(
            &fixture.connection_id,
            BrowserToolResponse::Error(ToolError {
                protocol_version: call.protocol_version,
                request_id: call.request_id,
                context_id: call.context_id,
                context_revision: call.context_revision,
                origin: call.origin,
                code: ErrorCode::ExecutionFailed,
                message: "Demo execution failed.".to_owned(),
                retryable: false,
            }),
        )
        .unwrap();

    let result = complete(task).await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(
        result.structured_content,
        Some(json!({
            "code": "EXECUTION_FAILED",
            "message": "Demo execution failed.",
            "retryable": false
        }))
    );
}

#[tokio::test]
async fn rejects_arguments_before_browser_dispatch() {
    let fixture = fixture(Duration::from_millis(100)).await;
    let mut arguments = Map::new();
    arguments.insert("unexpected".to_owned(), Value::Bool(true));

    let error = fixture
        .runtime
        .execute(request(arguments), CancellationToken::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, McpErrorCode::INVALID_PARAMS);
    assert!(
        timeout(
            Duration::from_millis(20),
            fixture.browser.receive_from_bridge()
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn rejects_missing_and_denied_tools_before_browser_dispatch() {
    let missing = fixture(Duration::from_millis(100)).await;
    let error = missing
        .runtime
        .execute(
            request_named("mcpatch.demo.missing", Map::new()),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, McpErrorCode::INVALID_PARAMS);
    assert_no_browser_dispatch(&missing.browser).await;

    let denied = fixture_with_capability(Duration::from_millis(100), |capability| {
        capability.risk = Risk::Sensitive;
        capability.permissions = vec![Permission::Sensitive, Permission::Credential];
    })
    .await;
    let error = denied
        .runtime
        .execute(request(Map::new()), CancellationToken::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, McpErrorCode::INVALID_PARAMS);
    assert_no_browser_dispatch(&denied.browser).await;
}

#[tokio::test]
async fn send_failure_consumes_the_pending_request() {
    let fixture = fixture(Duration::from_millis(100)).await;
    drop(fixture.browser);

    let result = fixture
        .runtime
        .execute(request(Map::new()), CancellationToken::new())
        .await
        .unwrap();
    let CallToolResponse::Complete(result) = result else {
        panic!("send failure must complete without MRTR");
    };
    assert_eq!(result.is_error, Some(true));
    assert!(
        fixture
            .registry
            .lock()
            .await
            .cancel_request("mcp.0000000000000001")
            .is_none()
    );
}

#[tokio::test]
async fn cancellation_removes_the_request_and_notifies_the_browser() {
    let fixture = fixture(Duration::from_millis(100)).await;
    let cancellation = CancellationToken::new();
    let task = spawn_call(&fixture.runtime, cancellation.clone(), Map::new());
    let call = receive_call(&fixture.browser).await;

    cancellation.cancel();
    let Message::Cancel(cancel) = receive_message(&fixture.browser).await else {
        panic!("MCP cancellation must reach the browser");
    };
    assert_eq!(cancel.request_id, call.request_id);
    assert_eq!(complete(task).await.is_error, Some(true));
    assert!(
        fixture
            .registry
            .lock()
            .await
            .cancel_request(&call.request_id)
            .is_none()
    );
}

#[tokio::test]
async fn timeout_removes_the_request_and_notifies_the_browser() {
    let fixture = fixture(Duration::from_millis(20)).await;
    let task = spawn_call(&fixture.runtime, CancellationToken::new(), Map::new());
    let call = receive_call(&fixture.browser).await;

    let Message::Cancel(cancel) = receive_message(&fixture.browser).await else {
        panic!("timed-out call must cancel the browser request");
    };
    assert_eq!(cancel.request_id, call.request_id);
    assert_eq!(complete(task).await.is_error, Some(true));
}

#[tokio::test]
async fn invalid_output_and_disconnect_fail_without_returning_browser_data() {
    let invalid = fixture(Duration::from_millis(100)).await;
    let invalid_task = spawn_call(&invalid.runtime, CancellationToken::new(), Map::new());
    let call = receive_call(&invalid.browser).await;
    assert!(
        invalid
            .registry
            .lock()
            .await
            .accept_response(
                &invalid.connection_id,
                BrowserToolResponse::Result(ToolResult {
                    protocol_version: call.protocol_version,
                    request_id: call.request_id,
                    context_id: call.context_id,
                    context_revision: call.context_revision,
                    origin: call.origin,
                    result: json!({"secret": "must-not-pass"}),
                }),
            )
            .is_err()
    );
    let invalid_result = complete(invalid_task).await;
    assert_eq!(invalid_result.is_error, Some(true));
    assert!(!format!("{invalid_result:?}").contains("must-not-pass"));

    let disconnected = fixture(Duration::from_millis(100)).await;
    let disconnected_task = spawn_call(&disconnected.runtime, CancellationToken::new(), Map::new());
    receive_call(&disconnected.browser).await;
    disconnected
        .registry
        .lock()
        .await
        .remove_connection(&disconnected.connection_id);
    assert_eq!(complete(disconnected_task).await.is_error, Some(true));
}

struct Fixture {
    browser: FakeBrowserPeer,
    connection_id: BrowserConnectionId,
    registry: SharedCapabilityRegistry,
    runtime: McpCallRuntime,
}

async fn fixture(call_timeout: Duration) -> Fixture {
    fixture_with_capability(call_timeout, |_| {}).await
}

async fn fixture_with_capability(
    call_timeout: Duration,
    update: impl FnOnce(&mut crate::protocol::Capability),
) -> Fixture {
    let registry = shared_capability_registry();
    let (connection, browser) = fake_browser_connection(
        BrowserConnectionId::parse("connection-a").unwrap(),
        NonZeroUsize::new(8).unwrap(),
    );
    let connection_id = connection.id().clone();
    let Message::CapabilitySnapshot(mut snapshot) = parse_message(include_bytes!(
        "../../../../../packages/protocol/fixtures/v1/valid/demo-capability-snapshot.json"
    ))
    .unwrap() else {
        panic!("demo fixture must contain a capability snapshot");
    };
    update(&mut snapshot.capabilities[0]);
    {
        let mut registry = registry.lock().await;
        registry.add_connection(connection).unwrap();
        registry.replace_snapshot(&connection_id, snapshot).unwrap();
    }
    let runtime = McpCallRuntime::with_timeout(registry.clone(), call_timeout);
    Fixture {
        browser,
        connection_id,
        registry,
        runtime,
    }
}

fn spawn_call(
    runtime: &McpCallRuntime,
    cancellation: CancellationToken,
    arguments: Map<String, Value>,
) -> tokio::task::JoinHandle<Result<CallToolResponse, rmcp::ErrorData>> {
    let runtime = runtime.clone();
    tokio::spawn(async move { runtime.execute(request(arguments), cancellation).await })
}

fn request(arguments: Map<String, Value>) -> CallToolRequestParams {
    request_named("mcpatch.demo.status", arguments)
}

fn request_named(name: &str, arguments: Map<String, Value>) -> CallToolRequestParams {
    CallToolRequestParams::new(name.to_owned()).with_arguments(arguments)
}

async fn receive_call(browser: &FakeBrowserPeer) -> crate::protocol::ToolCall {
    let Message::ToolCall(call) = receive_message(browser).await else {
        panic!("browser must receive a tool call");
    };
    call
}

async fn receive_message(browser: &FakeBrowserPeer) -> Message {
    timeout(TEST_TIMEOUT, browser.receive_from_bridge())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}

async fn assert_no_browser_dispatch(browser: &FakeBrowserPeer) {
    assert!(
        timeout(Duration::from_millis(20), browser.receive_from_bridge())
            .await
            .is_err()
    );
}

async fn complete(
    task: tokio::task::JoinHandle<Result<CallToolResponse, rmcp::ErrorData>>,
) -> rmcp::model::CallToolResult {
    let CallToolResponse::Complete(result) =
        timeout(TEST_TIMEOUT, task).await.unwrap().unwrap().unwrap()
    else {
        panic!("tool call must complete without MRTR");
    };
    result
}
