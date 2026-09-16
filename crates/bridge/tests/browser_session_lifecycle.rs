mod browser_session_support;

use std::time::Duration;

use browser_session_support::*;
use mcpatch_bridge::{
    browser::BrowserSessionErrorCode,
    local_ipc::read_json_frame,
    protocol::{
        ApprovalDecision, ApprovalRequester, ApprovalResult, CapabilitySource, ContextClosed,
        ContextClosedReason, ErrorCode, Message, PROTOCOL_VERSION, PackReference, Permission, Risk,
        ToolError, ToolResult, parse_message,
    },
    routing::{
        CallReservation, RegistryErrorCode, RoutedCall, SharedCapabilityRegistry, ToolInvocation,
        shared_capability_registry,
    },
};
use serde_json::{Map, json};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn applies_snapshots_and_context_closure_with_cancellation() {
    let registry = shared_capability_registry();
    let manager = manager(registry.clone(), Duration::from_secs(1));
    let (mut client, task) = start_session(&manager, CancellationToken::new());
    negotiate(&mut client, vec![PROTOCOL_VERSION]).await;
    send_message(&mut client, Message::CapabilitySnapshot(snapshot())).await;
    wait_for_capabilities(&registry, 1).await;

    let routed = route(&registry, "request-1").await;
    let revocation = routed.revocation();
    routed.dispatch().await.unwrap();
    assert!(matches!(
        receive_message(&mut client).await,
        Message::ToolCall(_)
    ));

    send_message(
        &mut client,
        Message::ContextClosed(ContextClosed {
            protocol_version: PROTOCOL_VERSION,
            context_id: "tab-1".to_owned(),
            context_revision: 1,
            reason: ContextClosedReason::Navigation,
        }),
    )
    .await;
    let Message::Cancel(cancellation) = receive_message(&mut client).await else {
        panic!("context closure must cancel its in-flight call");
    };
    assert_eq!(cancellation.request_id, "request-1");
    assert!(revocation.is_cancelled());
    wait_for_capabilities(&registry, 0).await;
    assert!(!task.is_finished());

    drop(client);
    assert_eq!(join(task).await, Ok(()));
}

#[tokio::test]
async fn authenticated_session_completes_an_exact_one_time_approval() {
    let registry = shared_capability_registry();
    let manager = manager(registry.clone(), Duration::from_secs(1));
    let (mut client, task) = start_session(&manager, CancellationToken::new());
    negotiate(&mut client, vec![PROTOCOL_VERSION]).await;
    let mut elevated = snapshot();
    let capability = &mut elevated.capabilities[0];
    capability.source = CapabilitySource::Pack;
    capability.pack = Some(PackReference {
        publisher: "mcpatch.dev".to_owned(),
        id: "approval-test".to_owned(),
        version: "0.1.0".to_owned(),
        digest: format!("sha256:{}", "a".repeat(64)),
    });
    capability.risk = Risk::Action;
    capability.permissions = vec![Permission::Action];
    send_message(&mut client, Message::CapabilitySnapshot(elevated)).await;
    wait_for_capabilities(&registry, 1).await;

    let now = time::OffsetDateTime::now_utc();
    let approval = {
        let mut registry = registry.lock().await;
        match registry
            .prepare_call(
                ToolInvocation {
                    request_id: "request-approval".to_owned(),
                    tool: "demo.read".to_owned(),
                    arguments: Map::new(),
                },
                now,
                Duration::from_secs(60),
                ApprovalRequester {
                    client: "Claude Code".to_owned(),
                    session: "session-0001".to_owned(),
                },
            )
            .unwrap()
        {
            CallReservation::Approval(approval) => approval,
            CallReservation::Call(_) => panic!("action must wait for approval"),
        }
    };
    approval.dispatch().await.unwrap();
    let Message::ApprovalRequired(required) = receive_message(&mut client).await else {
        panic!("bridge must send an approval request");
    };
    send_message(
        &mut client,
        Message::ApprovalResult(ApprovalResult {
            protocol_version: PROTOCOL_VERSION,
            approval_id: required.approval_id,
            request_id: required.request_id,
            decision: ApprovalDecision::Approved,
        }),
    )
    .await;

    let grant = approval.completion().await.unwrap();
    let routed = registry
        .lock()
        .await
        .route_approved(grant, time::OffsetDateTime::now_utc())
        .unwrap();
    routed.dispatch().await.unwrap();
    assert!(matches!(
        receive_message(&mut client).await,
        Message::ToolCall(_)
    ));

    drop(client);
    assert_eq!(join(task).await, Ok(()));
}

#[tokio::test]
async fn accepts_only_route_bound_results_and_errors() {
    let registry = shared_capability_registry();
    let manager = manager(registry.clone(), Duration::from_secs(1));
    let (mut client, task) = start_session(&manager, CancellationToken::new());
    negotiate(&mut client, vec![PROTOCOL_VERSION]).await;
    send_message(&mut client, Message::CapabilitySnapshot(snapshot())).await;
    wait_for_capabilities(&registry, 1).await;

    let first = route(&registry, "request-1").await;
    first.dispatch().await.unwrap();
    assert!(matches!(
        receive_message(&mut client).await,
        Message::ToolCall(_)
    ));
    send_message(
        &mut client,
        Message::ToolResult(ToolResult {
            protocol_version: PROTOCOL_VERSION,
            request_id: "request-1".to_owned(),
            context_id: "tab-1".to_owned(),
            context_revision: 1,
            origin: "https://example.com".to_owned(),
            result: json!({"ok": true}),
            content: vec![],
        }),
    )
    .await;

    let second = wait_for_reusable_request(&registry, "request-1").await;
    second.dispatch().await.unwrap();
    assert!(matches!(
        receive_message(&mut client).await,
        Message::ToolCall(_)
    ));
    send_message(
        &mut client,
        Message::ToolError(ToolError {
            protocol_version: PROTOCOL_VERSION,
            request_id: "request-1".to_owned(),
            context_id: "tab-1".to_owned(),
            context_revision: 1,
            origin: "https://example.com".to_owned(),
            code: ErrorCode::ExecutionFailed,
            message: "demo failed".to_owned(),
            retryable: false,
        }),
    )
    .await;

    let third = wait_for_reusable_request(&registry, "request-1").await;
    let revocation = third.revocation();
    drop(client);
    assert_eq!(join(task).await, Ok(()));
    assert!(revocation.is_cancelled());
}

#[tokio::test]
async fn mismatched_response_revokes_only_the_offending_session() {
    let registry = shared_capability_registry();
    let manager = manager(registry.clone(), Duration::from_secs(1));
    let (mut client, task) = start_session(&manager, CancellationToken::new());
    negotiate(&mut client, vec![PROTOCOL_VERSION]).await;
    send_message(&mut client, Message::CapabilitySnapshot(snapshot())).await;
    wait_for_capabilities(&registry, 1).await;
    let routed = route(&registry, "request-1").await;
    let revocation = routed.revocation();
    routed.dispatch().await.unwrap();
    assert!(matches!(
        receive_message(&mut client).await,
        Message::ToolCall(_)
    ));

    send_message(
        &mut client,
        Message::ToolResult(ToolResult {
            protocol_version: PROTOCOL_VERSION,
            request_id: "request-1".to_owned(),
            context_id: "tab-1".to_owned(),
            context_revision: 1,
            origin: "https://attacker.example".to_owned(),
            result: json!({"ok": true}),
            content: vec![],
        }),
    )
    .await;

    assert_eq!(
        join(task).await.unwrap_err().code(),
        BrowserSessionErrorCode::RegistryRejected
    );
    assert!(revocation.is_cancelled());
    assert_eq!(registry.lock().await.connection_count(), 0);

    let (mut replacement, replacement_task) = start_session(&manager, CancellationToken::new());
    negotiate(&mut replacement, vec![PROTOCOL_VERSION]).await;
    assert!(!replacement_task.is_finished());
    drop(replacement);
    assert_eq!(join(replacement_task).await, Ok(()));
}

#[tokio::test]
async fn stale_snapshot_uses_the_common_disconnect_cleanup() {
    let registry = shared_capability_registry();
    let manager = manager(registry.clone(), Duration::from_secs(1));
    let (mut client, task) = start_session(&manager, CancellationToken::new());
    negotiate(&mut client, vec![PROTOCOL_VERSION]).await;
    let mut current = snapshot();
    current.context_revision = 2;
    send_message(&mut client, Message::CapabilitySnapshot(current)).await;
    wait_for_capabilities(&registry, 1).await;
    send_message(&mut client, Message::CapabilitySnapshot(snapshot())).await;

    assert_eq!(
        join(task).await.unwrap_err().code(),
        BrowserSessionErrorCode::RegistryRejected
    );
    let registry = registry.lock().await;
    assert_eq!(registry.connection_count(), 0);
    assert!(registry.visible_capabilities().is_empty());
}

async fn receive_message(client: &mut TestClient) -> Message {
    let payload = timeout(TEST_TIMEOUT, read_json_frame(&mut client.reader))
        .await
        .unwrap()
        .unwrap()
        .expect("browser session closed before sending a message");
    parse_message(&payload).unwrap()
}

async fn wait_for_capabilities(registry: &SharedCapabilityRegistry, expected: usize) {
    timeout(TEST_TIMEOUT, async {
        loop {
            if registry.lock().await.visible_capabilities().len() == expected {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

async fn route(registry: &SharedCapabilityRegistry, request_id: &str) -> RoutedCall {
    registry
        .lock()
        .await
        .route_call(ToolInvocation {
            request_id: request_id.to_owned(),
            tool: "demo.read".to_owned(),
            arguments: Map::new(),
        })
        .unwrap()
}

async fn wait_for_reusable_request(
    registry: &SharedCapabilityRegistry,
    request_id: &str,
) -> RoutedCall {
    timeout(TEST_TIMEOUT, async {
        loop {
            match registry.lock().await.route_call(ToolInvocation {
                request_id: request_id.to_owned(),
                tool: "demo.read".to_owned(),
                arguments: Map::new(),
            }) {
                Ok(routed) => return routed,
                Err(error) if error.code() == RegistryErrorCode::DuplicateRequest => {
                    tokio::task::yield_now().await;
                }
                Err(error) => panic!("request reuse failed: {:?}", error.code()),
            }
        }
    })
    .await
    .unwrap()
}
