use std::{num::NonZeroUsize, sync::Arc};

use mcpatch_bridge::{
    browser::{
        BrowserConnection, BrowserConnectionErrorCode, BrowserConnectionId, FakeBrowserPeer,
        fake_browser_connection,
    },
    protocol::{
        Capability, CapabilitySnapshot, CapabilitySource, ContextClosed, ContextClosedReason,
        JsonObject, Message, PROTOCOL_VERSION, Permission, Risk, ToolError, ToolResult,
    },
    routing::{
        BrowserToolResponse, CapabilityRegistry, RegistryErrorCode, RoutedCallCompletionError,
        ToolInvocation,
    },
};
use serde_json::{Value, json};

#[tokio::test]
async fn routes_a_valid_read_call_to_the_exact_registered_context() {
    let (mut registry, id, browser) = registry_with_connection("connection-a");
    registry
        .replace_snapshot(
            &id,
            snapshot("tab-7", 3, vec![read_capability("demo.read")]),
        )
        .expect("snapshot must register");

    assert_eq!(
        registry
            .visible_capabilities()
            .into_iter()
            .map(|capability| capability.name)
            .collect::<Vec<_>>(),
        vec!["demo.read"]
    );

    let routed = registry
        .route_call(invocation(
            "request-1",
            "demo.read",
            json!({"query": "sensitive-marker"}),
        ))
        .expect("read call must route");
    assert_eq!(routed.message().context_id, "tab-7");
    assert_eq!(routed.message().context_revision, 3);
    assert_eq!(routed.message().origin, "https://example.com");
    assert!(!format!("{routed:?}").contains("sensitive-marker"));

    routed.dispatch().await.expect("routed call must send");
    assert_eq!(
        browser
            .receive_from_bridge()
            .await
            .expect("fake browser receive must succeed"),
        Some(Message::ToolCall(routed.message().clone()))
    );
}

#[test]
fn rejects_duplicate_and_unknown_connections() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    let (duplicate, _duplicate_browser) = connection("connection-a");
    assert_eq!(
        registry
            .add_connection(duplicate)
            .expect_err("duplicate connection ID must fail")
            .code(),
        RegistryErrorCode::ConnectionAlreadyExists
    );

    let unknown = BrowserConnectionId::parse("connection-unknown").expect("id must be valid");
    assert_eq!(
        registry
            .replace_snapshot(
                &unknown,
                snapshot("tab-7", 1, vec![read_capability("demo.read")]),
            )
            .expect_err("unknown connection must fail")
            .code(),
        RegistryErrorCode::ConnectionNotFound
    );
    assert!(registry.visible_capabilities().is_empty());
    assert_eq!(id.as_str(), "connection-a");
}

#[test]
fn hides_and_rejects_ambiguous_tool_names_across_contexts() {
    let (mut registry, first_id, _first_browser) = registry_with_connection("connection-a");
    let (second_connection, _second_browser) = connection("connection-b");
    let second_id = second_connection.id().clone();
    registry
        .add_connection(second_connection)
        .expect("second connection must register");

    registry
        .replace_snapshot(
            &first_id,
            snapshot("tab-a", 1, vec![read_capability("demo.read")]),
        )
        .expect("first snapshot must register");
    registry
        .replace_snapshot(
            &second_id,
            snapshot("tab-b", 1, vec![read_capability("demo.read")]),
        )
        .expect("second snapshot must register");

    assert!(registry.visible_capabilities().is_empty());
    assert_eq!(
        registry
            .route_call(invocation(
                "request-1",
                "demo.read",
                json!({"query": "safe"})
            ))
            .expect_err("ambiguous tool must fail closed")
            .code(),
        RegistryErrorCode::AmbiguousTool
    );
}

#[test]
fn rejects_snapshot_origin_mismatch_without_mutating_the_registry() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    let mut capability = read_capability("demo.read");
    capability.origin = "https://attacker.example".to_owned();

    assert_eq!(
        registry
            .replace_snapshot(&id, snapshot("tab-7", 1, vec![capability]))
            .expect_err("origin mismatch must fail")
            .code(),
        RegistryErrorCode::OriginMismatch
    );
    assert!(registry.visible_capabilities().is_empty());
}

#[test]
fn applies_default_deny_permission_policy() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    let action = capability("demo.action", Risk::Action, vec![Permission::Action]);
    let credential = capability(
        "demo.credential",
        Risk::Read,
        vec![Permission::Read, Permission::Credential],
    );
    registry
        .replace_snapshot(&id, snapshot("tab-7", 1, vec![action, credential]))
        .expect("valid metadata must register");

    assert_eq!(
        registry
            .visible_capabilities()
            .into_iter()
            .map(|capability| capability.name)
            .collect::<Vec<_>>(),
        vec!["demo.action"]
    );
    assert_eq!(
        registry
            .route_call(invocation(
                "request-1",
                "demo.action",
                json!({"query": "safe"})
            ))
            .expect_err("action needs an approval")
            .code(),
        RegistryErrorCode::ApprovalRequired
    );
    assert_eq!(
        registry
            .route_call(invocation(
                "request-2",
                "demo.credential",
                json!({"query": "safe"}),
            ))
            .expect_err("credential access is denied")
            .code(),
        RegistryErrorCode::CapabilityDenied
    );
}

#[test]
fn validates_call_arguments_against_the_registered_schema() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    registry
        .replace_snapshot(
            &id,
            snapshot("tab-7", 1, vec![read_capability("demo.read")]),
        )
        .expect("snapshot must register");

    assert_eq!(
        registry
            .route_call(invocation("request-1", "demo.read", json!({})))
            .expect_err("missing required argument must fail")
            .code(),
        RegistryErrorCode::InvalidArguments
    );
    assert_eq!(
        registry
            .route_call(invocation(
                "request-3",
                "demo.undeclared",
                json!({"query": "safe"}),
            ))
            .expect_err("undeclared tool must fail")
            .code(),
        RegistryErrorCode::ToolNotFound
    );
    assert_eq!(
        registry
            .route_call(invocation(
                "request-2",
                "demo.read",
                json!({"query": "safe", "extra": true}),
            ))
            .expect_err("additional argument must fail")
            .code(),
        RegistryErrorCode::InvalidArguments
    );
}

#[test]
fn rejects_unresolvable_schema_references_at_registration() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    let mut capability = read_capability("demo.read");
    capability.input_schema = object(json!({
        "type": "object",
        "$ref": "https://attacker.example/schema.json"
    }));

    // `$ref` is outside the runtime keyword allowlist, so the snapshot is
    // rejected as invalid protocol data before any compiler could resolve it.
    assert_eq!(
        registry
            .replace_snapshot(&id, snapshot("tab-7", 1, vec![capability]))
            .expect_err("remote schema references must fail closed")
            .code(),
        RegistryErrorCode::InvalidMessage
    );
}

#[test]
fn rejects_excessively_deep_schemas_before_compilation() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    let mut capability = read_capability("demo.read");
    let mut nested = json!({"type": "string"});
    for _ in 0..40 {
        nested = json!({
            "type": "object",
            "properties": {"nested": nested}
        });
    }
    capability.input_schema = object(nested);

    // Protocol validation bounds schema depth in the same JSON-nesting units
    // as the compiler, so the snapshot is rejected before compilation starts.
    assert_eq!(
        registry
            .replace_snapshot(&id, snapshot("tab-7", 1, vec![capability]))
            .expect_err("deep schema must fail before compilation")
            .code(),
        RegistryErrorCode::InvalidMessage
    );
}

#[test]
fn snapshots_are_atomic_monotonic_and_idempotent() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    let initial = snapshot("tab-7", 2, vec![read_capability("demo.read")]);
    let first = registry
        .replace_snapshot(&id, initial.clone())
        .expect("first snapshot must register");
    assert!(first.changed);

    let duplicate = registry
        .replace_snapshot(&id, initial)
        .expect("exact replay must be idempotent");
    assert!(!duplicate.changed);

    assert_eq!(
        registry
            .replace_snapshot(
                &id,
                snapshot("tab-7", 1, vec![read_capability("demo.older")]),
            )
            .expect_err("older snapshot must fail")
            .code(),
        RegistryErrorCode::StaleRevision
    );
    assert_eq!(
        registry
            .replace_snapshot(
                &id,
                snapshot("tab-7", 2, vec![read_capability("demo.changed")]),
            )
            .expect_err("same revision with different data must fail")
            .code(),
        RegistryErrorCode::RevisionConflict
    );
}

#[tokio::test]
async fn replacing_or_closing_a_context_revokes_its_in_flight_calls() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    registry
        .replace_snapshot(
            &id,
            snapshot("tab-7", 1, vec![read_capability("demo.read")]),
        )
        .expect("snapshot must register");
    let first = registry
        .route_call(invocation(
            "request-1",
            "demo.read",
            json!({"query": "safe"}),
        ))
        .expect("call must route");

    let replacement = registry
        .replace_snapshot(
            &id,
            snapshot("tab-7", 2, vec![read_capability("demo.read")]),
        )
        .expect("newer snapshot must replace");
    assert!(first.revocation().is_cancelled());
    assert_eq!(replacement.cancellations.len(), 1);
    assert_eq!(
        replacement.cancellations[0].message().request_id,
        "request-1"
    );
    assert_eq!(
        first
            .dispatch()
            .await
            .expect_err("revoked route must not dispatch")
            .code(),
        BrowserConnectionErrorCode::Closed
    );

    let second = registry
        .route_call(invocation(
            "request-2",
            "demo.read",
            json!({"query": "safe"}),
        ))
        .expect("replacement call must route");
    let closed = registry
        .close_context(
            &id,
            ContextClosed {
                protocol_version: PROTOCOL_VERSION,
                context_id: "tab-7".to_owned(),
                context_revision: 2,
                reason: ContextClosedReason::Navigation,
            },
        )
        .expect("context must close");
    assert!(second.revocation().is_cancelled());
    assert_eq!(closed.cancellations.len(), 1);
    assert!(registry.visible_capabilities().is_empty());
}

#[tokio::test]
async fn disconnect_removes_contexts_and_revokes_calls() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    registry
        .replace_snapshot(
            &id,
            snapshot("tab-7", 1, vec![read_capability("demo.read")]),
        )
        .expect("snapshot must register");
    let routed = registry
        .route_call(invocation(
            "request-1",
            "demo.read",
            json!({"query": "safe"}),
        ))
        .expect("call must route");

    assert!(registry.remove_connection(&id));
    assert!(routed.revocation().is_cancelled());
    assert_eq!(
        routed.completion().await.unwrap_err(),
        RoutedCallCompletionError::Revoked
    );
    assert!(registry.visible_capabilities().is_empty());
    assert!(!registry.remove_connection(&id));
}

#[tokio::test]
async fn duplicate_requests_fail_and_cancellation_is_idempotent() {
    let (mut registry, id, browser) = registry_with_connection("connection-a");
    registry
        .replace_snapshot(
            &id,
            snapshot("tab-7", 1, vec![read_capability("demo.read")]),
        )
        .expect("snapshot must register");
    let routed = registry
        .route_call(invocation(
            "request-1",
            "demo.read",
            json!({"query": "safe"}),
        ))
        .expect("call must route");

    assert_eq!(
        registry
            .route_call(invocation(
                "request-1",
                "demo.read",
                json!({"query": "safe"})
            ))
            .expect_err("duplicate request must fail")
            .code(),
        RegistryErrorCode::DuplicateRequest
    );

    let cancellation = registry
        .cancel_request("request-1")
        .expect("first cancellation must route");
    assert!(routed.revocation().is_cancelled());
    assert_eq!(cancellation.message().request_id, "request-1");
    cancellation
        .dispatch()
        .await
        .expect("cancellation must dispatch");
    assert_eq!(
        browser
            .receive_from_bridge()
            .await
            .expect("fake browser receive must succeed"),
        Some(Message::Cancel(cancellation.message().clone()))
    );
    assert_eq!(
        routed.completion().await.unwrap_err(),
        RoutedCallCompletionError::Revoked
    );
    assert!(registry.cancel_request("request-1").is_none());
}

#[tokio::test]
async fn accepts_only_results_bound_to_the_original_route() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    let (other_connection, _other_browser) = connection("connection-b");
    let other_id = other_connection.id().clone();
    registry
        .add_connection(other_connection)
        .expect("second connection must register");
    registry
        .replace_snapshot(
            &id,
            snapshot("tab-7", 3, vec![read_capability("demo.read")]),
        )
        .expect("snapshot must register");
    let routed = registry
        .route_call(invocation(
            "request-1",
            "demo.read",
            json!({"query": "safe"}),
        ))
        .expect("call must route");

    let unauthorized = ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".to_owned(),
        context_id: "tab-7".to_owned(),
        context_revision: 3,
        origin: "https://example.com".to_owned(),
        result: json!({"ok": true}),
        content: vec![],
    };
    assert_eq!(
        registry
            .accept_response(&other_id, BrowserToolResponse::Result(unauthorized))
            .expect_err("different connection must fail")
            .code(),
        RegistryErrorCode::Unauthorized
    );

    let wrong_context = ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".to_owned(),
        context_id: "tab-other".to_owned(),
        context_revision: 3,
        origin: "https://example.com".to_owned(),
        result: json!({"ok": true}),
        content: vec![],
    };
    assert_eq!(
        registry
            .accept_response(&id, BrowserToolResponse::Result(wrong_context))
            .expect_err("changed context must fail")
            .code(),
        RegistryErrorCode::RouteMismatch
    );

    let wrong_origin = ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".to_owned(),
        context_id: "tab-7".to_owned(),
        context_revision: 3,
        origin: "https://attacker.example".to_owned(),
        result: json!({"ok": true}),
        content: vec![],
    };
    assert_eq!(
        registry
            .accept_response(&id, BrowserToolResponse::Result(wrong_origin))
            .expect_err("changed origin must fail")
            .code(),
        RegistryErrorCode::OriginMismatch
    );

    let result = ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".to_owned(),
        context_id: "tab-7".to_owned(),
        context_revision: 3,
        origin: "https://example.com".to_owned(),
        result: json!({"ok": true}),
        content: vec![],
    };
    registry
        .accept_response(&id, BrowserToolResponse::Result(result.clone()))
        .expect("exact result route must be accepted");
    assert_eq!(
        routed.completion().await.unwrap(),
        BrowserToolResponse::Result(result)
    );
    assert_eq!(
        registry
            .accept_response(
                &id,
                BrowserToolResponse::Error(ToolError {
                    protocol_version: PROTOCOL_VERSION,
                    request_id: "request-1".to_owned(),
                    context_id: "tab-7".to_owned(),
                    context_revision: 3,
                    origin: "https://example.com".to_owned(),
                    code: mcpatch_bridge::protocol::ErrorCode::ExecutionFailed,
                    message: "late response".to_owned(),
                    retryable: false,
                }),
            )
            .expect_err("request must be consumed exactly once")
            .code(),
        RegistryErrorCode::RequestNotFound
    );
}

#[tokio::test]
async fn validates_and_consumes_browser_results() {
    let (mut registry, id, _browser) = registry_with_connection("connection-a");
    let mut capability = read_capability("demo.read");
    capability.output_schema = Some(object(json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["ok"],
        "properties": {"ok": {"type": "boolean"}}
    })));
    registry
        .replace_snapshot(&id, snapshot("tab-7", 1, vec![capability]))
        .expect("snapshot must register");
    let routed = registry
        .route_call(invocation(
            "request-1",
            "demo.read",
            json!({"query": "safe"}),
        ))
        .expect("call must route");

    let invalid = ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".to_owned(),
        context_id: "tab-7".to_owned(),
        context_revision: 1,
        origin: "https://example.com".to_owned(),
        result: json!({"ok": "not-a-boolean"}),
        content: vec![],
    };
    assert_eq!(
        registry
            .accept_response(&id, BrowserToolResponse::Result(invalid))
            .expect_err("invalid result must fail")
            .code(),
        RegistryErrorCode::ResultInvalid
    );
    assert_eq!(
        routed.completion().await.unwrap_err(),
        RoutedCallCompletionError::ResultInvalid
    );

    let valid_but_consumed = ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".to_owned(),
        context_id: "tab-7".to_owned(),
        context_revision: 1,
        origin: "https://example.com".to_owned(),
        result: json!({"ok": true}),
        content: vec![],
    };
    assert_eq!(
        registry
            .accept_response(&id, BrowserToolResponse::Result(valid_but_consumed))
            .expect_err("invalid result must consume the request")
            .code(),
        RegistryErrorCode::RequestNotFound
    );
}

fn registry_with_connection(
    id: &str,
) -> (CapabilityRegistry, BrowserConnectionId, FakeBrowserPeer) {
    let (connection, browser) = connection(id);
    let connection_id = connection.id().clone();
    let mut registry = CapabilityRegistry::new();
    registry
        .add_connection(connection)
        .expect("connection must register");
    (registry, connection_id, browser)
}

fn connection(id: &str) -> (Arc<dyn BrowserConnection>, FakeBrowserPeer) {
    let (connection, browser) = fake_browser_connection(
        BrowserConnectionId::parse(id).expect("connection ID must be valid"),
        NonZeroUsize::new(8).expect("capacity must be non-zero"),
    );
    (connection, browser)
}

fn snapshot(context_id: &str, revision: u64, capabilities: Vec<Capability>) -> CapabilitySnapshot {
    CapabilitySnapshot {
        protocol_version: PROTOCOL_VERSION,
        context_id: context_id.to_owned(),
        context_revision: revision,
        origin: "https://example.com".to_owned(),
        capabilities,
    }
}

fn read_capability(name: &str) -> Capability {
    capability(name, Risk::Read, vec![Permission::Read])
}

fn capability(name: &str, risk: Risk, permissions: Vec<Permission>) -> Capability {
    Capability {
        name: name.to_owned(),
        title: None,
        description: format!("Test capability {name}"),
        origin: "https://example.com".to_owned(),
        source: CapabilitySource::NativeWebMcp,
        pack: None,
        risk,
        permissions,
        input_schema: object(json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["query"],
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 64}
            }
        })),
        output_schema: None,
    }
}

fn invocation(request_id: &str, tool: &str, arguments: Value) -> ToolInvocation {
    ToolInvocation {
        request_id: request_id.to_owned(),
        tool: tool.to_owned(),
        arguments: object(arguments),
    }
}

fn object(value: Value) -> JsonObject {
    value.as_object().expect("value must be an object").clone()
}
