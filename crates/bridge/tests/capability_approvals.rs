use std::{num::NonZeroUsize, sync::Arc, time::Duration};

use mcpatch_bridge::{
    browser::{BrowserConnection, BrowserConnectionId, FakeBrowserPeer, fake_browser_connection},
    protocol::{
        ApprovalDecision, ApprovalResult, Capability, CapabilitySnapshot, CapabilitySource,
        ContextClosed, ContextClosedReason, JsonObject, Message, PROTOCOL_VERSION, PackReference,
        Permission, Risk,
    },
    routing::{
        APPROVAL_DENIAL_COOLDOWN, APPROVAL_DENIALS_BEFORE_COOLDOWN, APPROVAL_PROMPT_BURST,
        APPROVAL_PROMPT_REFILL_INTERVAL, ApprovalCompletionError, CallReservation,
        CapabilityRegistry, RegistryErrorCode, RoutedApproval, ToolInvocation,
        shared_capability_registry,
    },
};
use serde_json::{Value, json};
use time::OffsetDateTime;

const ORIGIN: &str = "https://example.com";

#[tokio::test]
async fn approval_message_is_random_route_bound_and_contains_no_raw_arguments() {
    let (mut registry, _id, browser) = action_registry();
    let now = fixed_time();
    let approval = prepare(
        &mut registry,
        invocation("request-1", "demo.action", "sensitive-marker"),
        now,
    );
    let message = approval.message().clone();

    assert!(message.approval_id.starts_with("approval."));
    assert_eq!(message.approval_id.len(), 41);
    assert_eq!(message.request_id, "request-1");
    assert_eq!(message.context_id, "tab-7");
    assert_eq!(message.context_revision, 1);
    assert_eq!(message.origin, ORIGIN);
    assert_eq!(message.tool, "demo.action");
    assert_eq!(message.args_hash.len(), 64);
    assert!(
        message
            .args_hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    );
    assert!(
        !serde_json::to_string(&message)
            .unwrap()
            .contains("sensitive-marker")
    );
    assert!(!format!("{approval:?}").contains("sensitive-marker"));

    let second = prepare(
        &mut registry,
        invocation("request-2", "demo.action", "sensitive-marker"),
        now,
    );
    assert_ne!(message.approval_id, second.message().approval_id);
    assert_eq!(message.args_hash, second.message().args_hash);
    let modified = prepare(
        &mut registry,
        invocation("request-3", "demo.action", "modified-marker"),
        now,
    );
    assert_ne!(message.args_hash, modified.message().args_hash);

    approval.dispatch().await.unwrap();
    assert_eq!(
        browser.receive_from_bridge().await.unwrap(),
        Some(Message::ApprovalRequired(message))
    );
}

#[tokio::test]
async fn approved_nonce_is_consumed_once_before_exact_dispatch() {
    let (mut registry, id, browser) = action_registry();
    let now = fixed_time();
    let approval = prepare(
        &mut registry,
        invocation("request-1", "demo.action", "approved-value"),
        now,
    );
    let result = approval_result(&approval, ApprovalDecision::Approved);

    registry
        .accept_approval_result(&id, result.clone(), now)
        .unwrap();
    assert_eq!(
        registry
            .accept_approval_result(&id, result, now)
            .unwrap_err()
            .code(),
        RegistryErrorCode::ApprovalNotFound
    );
    let grant = approval.completion().await.unwrap();
    assert!(!format!("{grant:?}").contains("approved-value"));
    let routed = registry.route_approved(grant, now).unwrap();
    assert_eq!(
        routed.message().args,
        object(json!({"query": "approved-value"}))
    );
    routed.dispatch().await.unwrap();
    assert!(matches!(
        browser.receive_from_bridge().await.unwrap(),
        Some(Message::ToolCall(_))
    ));
}

#[tokio::test]
async fn denied_expired_and_unknown_results_never_create_a_call() {
    let (mut denied_registry, denied_id, denied_browser) = action_registry();
    let now = fixed_time();
    let denied = prepare(
        &mut denied_registry,
        invocation("request-denied", "demo.action", "denied-value"),
        now,
    );
    denied_registry
        .accept_approval_result(
            &denied_id,
            approval_result(&denied, ApprovalDecision::Denied),
            now,
        )
        .unwrap();
    assert_eq!(
        denied.completion().await.unwrap_err(),
        ApprovalCompletionError::Denied
    );
    assert!(
        tokio::time::timeout(
            Duration::from_millis(20),
            denied_browser.receive_from_bridge(),
        )
        .await
        .is_err()
    );

    let (mut expired_registry, expired_id, _expired_browser) = action_registry();
    let expired = prepare(
        &mut expired_registry,
        invocation("request-expired", "demo.action", "expired-value"),
        now,
    );
    assert_eq!(
        expired_registry
            .accept_approval_result(
                &expired_id,
                approval_result(&expired, ApprovalDecision::Approved),
                now + time::Duration::seconds(60),
            )
            .unwrap_err()
            .code(),
        RegistryErrorCode::ApprovalExpired
    );
    assert_eq!(
        expired.completion().await.unwrap_err(),
        ApprovalCompletionError::Expired
    );

    let (mut late_registry, late_id, _late_browser) = action_registry();
    let late = prepare(
        &mut late_registry,
        invocation("request-late", "demo.action", "late-value"),
        now,
    );
    late_registry
        .accept_approval_result(
            &late_id,
            approval_result(&late, ApprovalDecision::Approved),
            now,
        )
        .unwrap();
    let grant = late.completion().await.unwrap();
    assert_eq!(
        late_registry
            .route_approved(grant, now + time::Duration::seconds(60))
            .unwrap_err()
            .code(),
        RegistryErrorCode::ApprovalExpired
    );

    let unknown = ApprovalResult {
        protocol_version: PROTOCOL_VERSION,
        approval_id: format!("approval.{}", "0".repeat(32)),
        request_id: "request-unknown".to_owned(),
        decision: ApprovalDecision::Approved,
    };
    assert_eq!(
        expired_registry
            .accept_approval_result(&expired_id, unknown, now)
            .unwrap_err()
            .code(),
        RegistryErrorCode::ApprovalNotFound
    );
}

#[tokio::test]
async fn route_change_after_decision_invalidates_the_grant() {
    let (mut registry, id, _browser) = action_registry();
    let now = fixed_time();
    let approval = prepare(
        &mut registry,
        invocation("request-1", "demo.action", "original"),
        now,
    );
    registry
        .accept_approval_result(
            &id,
            approval_result(&approval, ApprovalDecision::Approved),
            now,
        )
        .unwrap();
    let grant = approval.completion().await.unwrap();

    registry
        .replace_snapshot(&id, snapshot(2, action_capability()))
        .unwrap();
    // The decision was valid; its target changed. That is reported distinctly
    // from a binding mismatch so the caller knows to approve again.
    assert_eq!(
        registry.route_approved(grant, now).unwrap_err().code(),
        RegistryErrorCode::ApprovalContextChanged
    );
}

#[tokio::test]
async fn context_replacement_and_cancellation_revoke_pending_approval() {
    let (mut registry, id, browser) = action_registry();
    let now = fixed_time();
    let approval = prepare(
        &mut registry,
        invocation("request-1", "demo.action", "original"),
        now,
    );
    let revocation = approval.revocation();
    let change = registry
        .replace_snapshot(&id, snapshot(2, action_capability()))
        .unwrap();
    assert!(revocation.is_cancelled());
    assert_eq!(change.cancellations.len(), 1);
    assert_eq!(change.cancellations[0].message().request_id, "request-1");
    assert_eq!(
        approval.completion().await.unwrap_err(),
        ApprovalCompletionError::Revoked
    );

    let next = prepare(
        &mut registry,
        invocation("request-2", "demo.action", "cancelled"),
        now,
    );
    let cancellation = registry.cancel_request("request-2").unwrap();
    cancellation.dispatch().await.unwrap();
    assert_eq!(
        next.completion().await.unwrap_err(),
        ApprovalCompletionError::Revoked
    );
    assert!(registry.cancel_request("request-2").is_none());
    assert!(matches!(
        browser.receive_from_bridge().await.unwrap(),
        Some(Message::Cancel(_))
    ));
}

#[tokio::test]
async fn concurrent_decisions_have_exactly_one_winner() {
    let registry = shared_capability_registry();
    let (connection, _browser) = connection("connection-a");
    let id = connection.id().clone();
    {
        let mut state = registry.lock().await;
        state.add_connection(connection).unwrap();
        state
            .replace_snapshot(&id, snapshot(1, action_capability()))
            .unwrap();
    }
    let now = fixed_time();
    let approval = {
        let mut state = registry.lock().await;
        prepare(
            &mut state,
            invocation("request-1", "demo.action", "concurrent"),
            now,
        )
    };
    let result = approval_result(&approval, ApprovalDecision::Approved);
    let first_registry = registry.clone();
    let first_id = id.clone();
    let first_result = result.clone();
    let first = tokio::spawn(async move {
        first_registry
            .lock()
            .await
            .accept_approval_result(&first_id, first_result, now)
    });
    let second_registry = registry.clone();
    let second = tokio::spawn(async move {
        second_registry
            .lock()
            .await
            .accept_approval_result(&id, result, now)
    });
    let outcomes = [first.await.unwrap(), second.await.unwrap()];
    assert_eq!(outcomes.iter().filter(|value| value.is_ok()).count(), 1);
    assert_eq!(
        outcomes
            .iter()
            .filter_map(|value| value.as_ref().err())
            .next()
            .unwrap()
            .code(),
        RegistryErrorCode::ApprovalNotFound
    );
    assert!(approval.completion().await.is_ok());
}

#[tokio::test]
async fn approved_call_dispatches_to_the_bound_context_when_a_second_context_appears() {
    let (mut registry, id, browser) = action_registry();
    let now = fixed_time();
    let approval = prepare(
        &mut registry,
        invocation("request-1", "demo.action", "bound-value"),
        now,
    );
    registry
        .accept_approval_result(
            &id,
            approval_result(&approval, ApprovalDecision::Approved),
            now,
        )
        .unwrap();
    let grant = approval.completion().await.unwrap();

    // While the human was deciding, a second tab of the same site published the
    // same tool. Discovery hides the ambiguous name, but the approval was bound to
    // one exact registration and must still dispatch there.
    registry
        .replace_snapshot(&id, snapshot_in("tab-8", 1, action_capability()))
        .unwrap();
    assert!(registry.visible_capabilities().is_empty());

    let routed = registry.route_approved(grant, now).unwrap();
    assert_eq!(routed.message().context_id, "tab-7");
    assert_eq!(routed.message().context_revision, 1);
    routed.dispatch().await.unwrap();
    assert!(matches!(
        browser.receive_from_bridge().await.unwrap(),
        Some(Message::ToolCall(call)) if call.context_id == "tab-7"
    ));
}

#[tokio::test]
async fn approved_call_dispatches_to_the_bound_connection_when_another_connection_collides() {
    let (mut registry, id, browser) = action_registry();
    let now = fixed_time();
    let approval = prepare(
        &mut registry,
        invocation("request-1", "demo.action", "bound-value"),
        now,
    );
    registry
        .accept_approval_result(
            &id,
            approval_result(&approval, ApprovalDecision::Approved),
            now,
        )
        .unwrap();
    let grant = approval.completion().await.unwrap();

    // A second browser profile connects and advertises the same tool name.
    let (other, other_browser) = connection("connection-b");
    let other_id = other.id().clone();
    registry.add_connection(other).unwrap();
    registry
        .replace_snapshot(&other_id, snapshot(1, action_capability()))
        .unwrap();
    assert!(registry.visible_capabilities().is_empty());

    let routed = registry.route_approved(grant, now).unwrap();
    routed.dispatch().await.unwrap();
    assert!(matches!(
        browser.receive_from_bridge().await.unwrap(),
        Some(Message::ToolCall(_))
    ));
    assert!(
        tokio::time::timeout(
            Duration::from_millis(20),
            other_browser.receive_from_bridge()
        )
        .await
        .is_err(),
        "the colliding connection must never receive the approved call"
    );
}

#[tokio::test]
async fn approved_call_fails_distinctly_when_the_bound_context_changes() {
    let (mut registry, id, _browser) = action_registry();
    let now = fixed_time();

    // The bound document republished under a new revision (navigation).
    let approval = prepare(
        &mut registry,
        invocation("request-1", "demo.action", "replaced"),
        now,
    );
    registry
        .accept_approval_result(
            &id,
            approval_result(&approval, ApprovalDecision::Approved),
            now,
        )
        .unwrap();
    let grant = approval.completion().await.unwrap();
    registry
        .replace_snapshot(&id, snapshot(2, action_capability()))
        .unwrap();
    assert_eq!(
        registry.route_approved(grant, now).unwrap_err().code(),
        RegistryErrorCode::ApprovalContextChanged
    );

    // The bound document disappeared entirely before dispatch.
    let approval = prepare(
        &mut registry,
        invocation("request-2", "demo.action", "closed"),
        now,
    );
    registry
        .accept_approval_result(
            &id,
            approval_result(&approval, ApprovalDecision::Approved),
            now,
        )
        .unwrap();
    let grant = approval.completion().await.unwrap();
    registry
        .close_context(
            &id,
            ContextClosed {
                protocol_version: PROTOCOL_VERSION,
                context_id: "tab-7".to_owned(),
                context_revision: 3,
                reason: ContextClosedReason::Navigation,
            },
        )
        .unwrap();
    assert_eq!(
        registry.route_approved(grant, now).unwrap_err().code(),
        RegistryErrorCode::ApprovalContextChanged
    );
}

#[tokio::test]
async fn approval_prompts_are_budgeted_per_site() {
    let (mut registry, _id, browser) = action_registry();
    let now = fixed_time();
    for index in 0..APPROVAL_PROMPT_BURST {
        prepare(
            &mut registry,
            invocation(&format!("request-{index}"), "demo.action", "burst"),
            now,
        );
    }

    let refused = registry
        .prepare_call(
            invocation("request-refused", "demo.action", "burst"),
            now,
            Duration::from_secs(60),
        )
        .err()
        .expect("the seventh prompt must be refused");
    assert_eq!(refused.code(), RegistryErrorCode::ApprovalRateLimited);
    assert!(
        tokio::time::timeout(Duration::from_millis(20), browser.receive_from_bridge())
            .await
            .is_err(),
        "a refused prompt must never reach the browser"
    );

    let later = now + APPROVAL_PROMPT_REFILL_INTERVAL;
    prepare(
        &mut registry,
        invocation("request-refilled", "demo.action", "burst"),
        later,
    );
}

#[tokio::test]
async fn repeated_denials_put_the_site_in_a_cooldown() {
    let (mut registry, id, _browser) = action_registry();
    let now = fixed_time();
    for index in 0..APPROVAL_DENIALS_BEFORE_COOLDOWN {
        let approval = prepare(
            &mut registry,
            invocation(&format!("request-{index}"), "demo.action", "denied"),
            now,
        );
        registry
            .accept_approval_result(
                &id,
                approval_result(&approval, ApprovalDecision::Denied),
                now,
            )
            .unwrap();
    }

    assert_eq!(
        registry
            .prepare_call(
                invocation("request-cooldown", "demo.action", "denied"),
                now,
                Duration::from_secs(60),
            )
            .err()
            .expect("a site in cooldown must not prompt")
            .code(),
        RegistryErrorCode::ApprovalRateLimited
    );
    let released = now + APPROVAL_DENIAL_COOLDOWN;
    let approval = prepare(
        &mut registry,
        invocation("request-released", "demo.action", "denied"),
        released,
    );
    // One approval resets the consecutive-denial count.
    registry
        .accept_approval_result(
            &id,
            approval_result(&approval, ApprovalDecision::Approved),
            released,
        )
        .unwrap();
    prepare(
        &mut registry,
        invocation("request-after-approval", "demo.action", "denied"),
        released,
    );
}

#[tokio::test]
async fn pending_authority_does_not_survive_registry_restart() {
    let (mut original, id, _browser) = action_registry();
    let now = fixed_time();
    let approval = prepare(
        &mut original,
        invocation("request-1", "demo.action", "restart"),
        now,
    );
    let result = approval_result(&approval, ApprovalDecision::Approved);
    drop(original);
    assert_eq!(
        approval.completion().await.unwrap_err(),
        ApprovalCompletionError::Revoked
    );

    let mut restarted = CapabilityRegistry::new();
    assert_eq!(
        restarted
            .accept_approval_result(&id, result, now)
            .unwrap_err()
            .code(),
        RegistryErrorCode::ApprovalNotFound
    );
}

fn action_registry() -> (CapabilityRegistry, BrowserConnectionId, FakeBrowserPeer) {
    let (connection, browser) = connection("connection-a");
    let id = connection.id().clone();
    let mut registry = CapabilityRegistry::new();
    registry.add_connection(connection).unwrap();
    registry
        .replace_snapshot(&id, snapshot(1, action_capability()))
        .unwrap();
    (registry, id, browser)
}

fn connection(id: &str) -> (Arc<dyn BrowserConnection>, FakeBrowserPeer) {
    let (connection, browser) = fake_browser_connection(
        BrowserConnectionId::parse(id).unwrap(),
        NonZeroUsize::new(8).unwrap(),
    );
    (connection, browser)
}

fn prepare(
    registry: &mut CapabilityRegistry,
    invocation: ToolInvocation,
    now: OffsetDateTime,
) -> RoutedApproval {
    match registry
        .prepare_call(invocation, now, Duration::from_secs(60))
        .unwrap()
    {
        CallReservation::Approval(approval) => approval,
        CallReservation::Call(_) => panic!("action call must require approval"),
    }
}

fn approval_result(approval: &RoutedApproval, decision: ApprovalDecision) -> ApprovalResult {
    ApprovalResult {
        protocol_version: PROTOCOL_VERSION,
        approval_id: approval.message().approval_id.clone(),
        request_id: approval.message().request_id.clone(),
        decision,
    }
}

fn snapshot(revision: u64, capability: Capability) -> CapabilitySnapshot {
    snapshot_in("tab-7", revision, capability)
}

fn snapshot_in(context_id: &str, revision: u64, capability: Capability) -> CapabilitySnapshot {
    CapabilitySnapshot {
        protocol_version: PROTOCOL_VERSION,
        context_id: context_id.to_owned(),
        context_revision: revision,
        origin: ORIGIN.to_owned(),
        capabilities: vec![capability],
    }
}

fn action_capability() -> Capability {
    Capability {
        name: "demo.action".to_owned(),
        title: Some("Perform demo action".to_owned()),
        description: "Perform one bounded test action.".to_owned(),
        origin: ORIGIN.to_owned(),
        source: CapabilitySource::Pack,
        pack: Some(PackReference {
            publisher: "mcpatch.dev".to_owned(),
            id: "approval-test".to_owned(),
            version: "0.1.0".to_owned(),
            digest: format!("sha256:{}", "a".repeat(64)),
        }),
        risk: Risk::Action,
        permissions: vec![Permission::Action],
        input_schema: object(json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["query"],
            "properties": {"query": {"type": "string", "minLength": 1}}
        })),
        output_schema: Some(object(json!({"type": "object"}))),
    }
}

fn invocation(request_id: &str, tool: &str, query: &str) -> ToolInvocation {
    ToolInvocation {
        request_id: request_id.to_owned(),
        tool: tool.to_owned(),
        arguments: object(json!({"query": query})),
    }
}

fn object(value: Value) -> JsonObject {
    value.as_object().unwrap().clone()
}

fn fixed_time() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(2_000_000_000).unwrap()
}
