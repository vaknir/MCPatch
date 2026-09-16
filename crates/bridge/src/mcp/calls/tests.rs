use std::{num::NonZeroUsize, sync::Arc, time::Duration};

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ContentBlock, ErrorCode as McpErrorCode,
};
use serde_json::{Map, Value, json};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

use super::{DEFAULT_APPROVAL_TIMEOUT, McpCallRuntime};
use crate::{
    browser::{BrowserConnection, BrowserConnectionId, FakeBrowserPeer, fake_browser_connection},
    protocol::{
        ApprovalDecision, ApprovalResult, ErrorCode, Message, PROTOCOL_VERSION, Permission, Risk,
        ToolContent, ToolError, ToolImageContent, ToolResult, parse_message,
    },
    routing::{BrowserToolResponse, SharedCapabilityRegistry, shared_capability_registry},
};

const TEST_TIMEOUT: Duration = Duration::from_secs(1);

#[test]
fn approval_timeout_override_is_bounded_and_falls_back_loudly() {
    use std::ffi::OsStr;

    use super::{ApprovalTimeoutError, approval_timeout_from};

    assert_eq!(
        approval_timeout_from(None),
        Ok(super::DEFAULT_APPROVAL_TIMEOUT)
    );
    assert_eq!(
        approval_timeout_from(Some(OsStr::new("120"))),
        Ok(Duration::from_secs(120))
    );
    assert_eq!(
        approval_timeout_from(Some(OsStr::new(" 5 "))),
        Ok(Duration::from_secs(5))
    );
    for value in ["4", "301", "0"] {
        assert_eq!(
            approval_timeout_from(Some(OsStr::new(value))),
            Err(ApprovalTimeoutError::OutOfRange),
            "{value}"
        );
    }
    for value in ["", "sixty", "60s", "-1", "1e2"] {
        assert_eq!(
            approval_timeout_from(Some(OsStr::new(value))),
            Err(ApprovalTimeoutError::Unparseable),
            "{value}"
        );
    }
}

#[tokio::test]
async fn approval_wait_reports_argument_free_progress_to_the_client() {
    let fixture = elevated_fixture(Duration::from_millis(100), Duration::from_millis(100)).await;
    let progress = Arc::new(RecordedProgress::default());
    let task = spawn_call_with_progress(
        &fixture.runtime,
        CancellationToken::new(),
        Map::new(),
        Some(progress.clone()),
    );
    let Message::ApprovalRequired(_) = receive_message(&fixture.browser).await else {
        panic!("elevated call must request approval first");
    };
    // Nobody decides; the wait expires.
    assert_eq!(complete(task).await.is_error, Some(true));

    let sequences = progress.sequences.lock().unwrap().clone();
    assert_eq!(
        sequences,
        vec![1],
        "one report on dispatch, none within 100 ms"
    );
    assert!(!super::APPROVAL_WAIT_MESSAGE.contains("demo"));
    assert!(!super::APPROVAL_WAIT_MESSAGE.contains("invalid"));
    assert!(!super::APPROVAL_WAIT_MESSAGE.contains("http"));
}

#[test]
fn a_lost_approval_target_tells_the_caller_to_approve_again() {
    use crate::routing::RegistryErrorCode;

    let changed = super::approval_route_failure(RegistryErrorCode::ApprovalContextChanged);
    assert!(changed.contains("fresh approval"));
    for code in [
        RegistryErrorCode::ApprovalMismatch,
        RegistryErrorCode::ApprovalExpired,
        RegistryErrorCode::InvalidArguments,
        RegistryErrorCode::LimitExceeded,
    ] {
        assert_eq!(
            super::approval_route_failure(code),
            "The approval is no longer valid."
        );
    }
}

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
                content: vec![],
            }),
        )
        .unwrap();

    let result = complete(task).await;
    assert_eq!(result.structured_content, Some(json!({"status": "ready"})));
    assert_eq!(result.is_error, Some(false));
}

#[tokio::test]
async fn projects_bounded_browser_media_as_mcp_image_content() {
    let fixture = fixture_with_capability(Duration::from_millis(100), |capability| {
        capability.output_schema = Some(
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["symbol", "width", "height"],
                "properties": {
                    "symbol": {"type": "string"},
                    "width": {"type": "integer"},
                    "height": {"type": "integer"}
                }
            })
            .as_object()
            .unwrap()
            .clone(),
        );
    })
    .await;
    let task = spawn_call(&fixture.runtime, CancellationToken::new(), Map::new());
    let call = receive_call(&fixture.browser).await;
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
                result: json!({"symbol": "NASDAQ:AAPL", "width": 2, "height": 1}),
                content: vec![ToolContent::Image(ToolImageContent {
                    mime_type: "image/webp".to_owned(),
                    data: "UklGRg==".to_owned(),
                    width: 2,
                    height: 1,
                })],
            }),
        )
        .unwrap();

    let result = complete(task).await;
    assert_eq!(result.content.len(), 2);
    let ContentBlock::Image(image) = &result.content[1] else {
        panic!("bounded media must be projected as MCP image content");
    };
    assert_eq!(image.mime_type, "image/webp");
    assert_eq!(image.data, "UklGRg==");
    assert_eq!(
        result.structured_content,
        Some(json!({"symbol": "NASDAQ:AAPL", "width": 2, "height": 1}))
    );
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
        .execute(request(arguments), CancellationToken::new(), None)
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
            None,
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
        .execute(request(Map::new()), CancellationToken::new(), None)
        .await
        .unwrap_err();
    assert_eq!(error.code, McpErrorCode::INVALID_PARAMS);
    assert_no_browser_dispatch(&denied.browser).await;
}

#[tokio::test]
async fn elevated_call_dispatches_only_after_the_exact_approval() {
    let fixture = elevated_fixture(Duration::from_millis(100), Duration::from_millis(100)).await;
    let task = spawn_call(&fixture.runtime, CancellationToken::new(), Map::new());
    let Message::ApprovalRequired(approval) = receive_message(&fixture.browser).await else {
        panic!("elevated call must request approval first");
    };
    assert_eq!(approval.tool, "mcpatch.demo.status");
    assert_eq!(approval.origin, "https://demo.mcpatch.invalid");
    assert!(
        !serde_json::to_value(&approval)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("arguments")
    );
    assert_no_browser_dispatch(&fixture.browser).await;

    fixture
        .registry
        .lock()
        .await
        .accept_approval_result(
            &fixture.connection_id,
            ApprovalResult {
                protocol_version: PROTOCOL_VERSION,
                approval_id: approval.approval_id,
                request_id: approval.request_id,
                decision: ApprovalDecision::Approved,
            },
            time::OffsetDateTime::now_utc(),
        )
        .unwrap();
    let call = receive_call(&fixture.browser).await;
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
                content: vec![],
            }),
        )
        .unwrap();
    assert_eq!(complete(task).await.is_error, Some(false));
}

#[tokio::test]
async fn denial_cancellation_and_timeout_never_dispatch_an_elevated_call() {
    let denied = elevated_fixture(Duration::from_millis(100), Duration::from_millis(100)).await;
    let denied_task = spawn_call(&denied.runtime, CancellationToken::new(), Map::new());
    let Message::ApprovalRequired(approval) = receive_message(&denied.browser).await else {
        panic!("elevated call must request approval");
    };
    denied
        .registry
        .lock()
        .await
        .accept_approval_result(
            &denied.connection_id,
            ApprovalResult {
                protocol_version: PROTOCOL_VERSION,
                approval_id: approval.approval_id,
                request_id: approval.request_id,
                decision: ApprovalDecision::Denied,
            },
            time::OffsetDateTime::now_utc(),
        )
        .unwrap();
    assert_eq!(complete(denied_task).await.is_error, Some(true));
    assert_no_browser_dispatch(&denied.browser).await;

    let cancelled = elevated_fixture(Duration::from_millis(100), Duration::from_millis(100)).await;
    let cancellation = CancellationToken::new();
    let cancelled_task = spawn_call(&cancelled.runtime, cancellation.clone(), Map::new());
    receive_message(&cancelled.browser).await;
    cancellation.cancel();
    assert!(matches!(
        receive_message(&cancelled.browser).await,
        Message::Cancel(_)
    ));
    assert_eq!(complete(cancelled_task).await.is_error, Some(true));

    let expired = elevated_fixture(Duration::from_millis(100), Duration::from_millis(20)).await;
    let expired_task = spawn_call(&expired.runtime, CancellationToken::new(), Map::new());
    receive_message(&expired.browser).await;
    assert!(matches!(
        receive_message(&expired.browser).await,
        Message::Cancel(_)
    ));
    assert_eq!(complete(expired_task).await.is_error, Some(true));
}

#[tokio::test]
async fn send_failure_consumes_the_pending_request() {
    let fixture = fixture(Duration::from_millis(100)).await;
    drop(fixture.browser);

    let result = fixture
        .runtime
        .execute(request(Map::new()), CancellationToken::new(), None)
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
                    content: vec![],
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
    fixture_with_timeouts(call_timeout, DEFAULT_APPROVAL_TIMEOUT, update).await
}

async fn elevated_fixture(call_timeout: Duration, approval_timeout: Duration) -> Fixture {
    fixture_with_timeouts(call_timeout, approval_timeout, |capability| {
        capability.risk = Risk::Action;
        capability.permissions = vec![Permission::Action];
    })
    .await
}

async fn fixture_with_timeouts(
    call_timeout: Duration,
    approval_timeout: Duration,
    update: impl FnOnce(&mut crate::protocol::Capability),
) -> Fixture {
    let registry = shared_capability_registry();
    let (connection, browser) = fake_browser_connection(
        BrowserConnectionId::parse("connection-a").unwrap(),
        NonZeroUsize::new(8).unwrap(),
    );
    let connection_id = connection.id().clone();
    let Message::CapabilitySnapshot(mut snapshot) = parse_message(include_bytes!(
        "../../../../../packages/protocol/fixtures/v2/valid/demo-capability-snapshot.json"
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
    let runtime = McpCallRuntime::with_timeouts(registry.clone(), call_timeout, approval_timeout);
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
    spawn_call_with_progress(runtime, cancellation, arguments, None)
}

fn spawn_call_with_progress(
    runtime: &McpCallRuntime,
    cancellation: CancellationToken,
    arguments: Map<String, Value>,
    progress: Option<super::SharedApprovalProgress>,
) -> tokio::task::JoinHandle<Result<CallToolResponse, rmcp::ErrorData>> {
    let runtime = runtime.clone();
    tokio::spawn(async move {
        runtime
            .execute(request(arguments), cancellation, progress)
            .await
    })
}

/// Records every progress report so a test can assert what the client saw.
#[derive(Default)]
struct RecordedProgress {
    sequences: std::sync::Mutex<Vec<u32>>,
}

impl super::ApprovalProgress for RecordedProgress {
    fn report(&self, sequence: u32) -> futures_util::future::BoxFuture<'_, ()> {
        Box::pin(async move {
            self.sequences.lock().unwrap().push(sequence);
        })
    }
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
