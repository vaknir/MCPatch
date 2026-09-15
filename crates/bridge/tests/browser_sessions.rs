use std::{num::NonZeroUsize, time::Duration};

use mcpatch_bridge::{
    browser::{
        BrowserSessionConfig, BrowserSessionError, BrowserSessionErrorCode, BrowserSessionManager,
    },
    local_ipc::{read_json_frame, write_json_frame},
    protocol::{
        Capability, CapabilitySnapshot, CapabilitySource, Heartbeat, Hello, Implementation,
        Message, PROTOCOL_VERSION, Permission, Risk, Role, ToolCall, parse_message,
    },
    routing::{ToolInvocation, shared_capability_registry},
};
use serde_json::{Map, Value, json};
use tokio::{
    io::{DuplexStream, ReadHalf, WriteHalf},
    task::JoinHandle,
    time::timeout,
};
use tokio_util::sync::CancellationToken;

const TEST_TIMEOUT: Duration = Duration::from_secs(2);

#[tokio::test]
async fn negotiates_heartbeat_liveness_and_unique_connection_ids() {
    let registry = shared_capability_registry();
    let manager = manager(registry.clone(), Duration::from_millis(100));
    let shutdown = CancellationToken::new();
    let (mut first_client, first_task) = start_session(&manager, shutdown.clone());

    let first_id = negotiate(&mut first_client, vec![2, 1]).await;
    wait_for_connections(&registry, 1).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    send_message(&mut first_client, heartbeat("heartbeat-1")).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!first_task.is_finished());

    drop(first_client);
    assert_eq!(join(first_task).await, Ok(()));
    wait_for_connections(&registry, 0).await;

    let (mut second_client, second_task) = start_session(&manager, shutdown.clone());
    let second_id = negotiate(&mut second_client, vec![1]).await;
    assert_ne!(first_id, second_id);

    shutdown.cancel();
    assert_eq!(join(second_task).await, Ok(()));
    wait_for_connections(&registry, 0).await;
}

#[tokio::test]
async fn rejects_no_common_version_wrong_first_message_and_wrong_role() {
    let cases = [
        (
            hello(vec![2], Role::Extension),
            BrowserSessionErrorCode::NegotiationFailed,
        ),
        (
            heartbeat("not-a-hello"),
            BrowserSessionErrorCode::ProtocolViolation,
        ),
        (
            hello(vec![1], Role::Bridge),
            BrowserSessionErrorCode::InvalidRole,
        ),
    ];

    for (message, expected) in cases {
        let registry = shared_capability_registry();
        let manager = manager(registry.clone(), Duration::from_secs(1));
        let (mut client, task) = start_session(&manager, CancellationToken::new());
        send_message(&mut client, message).await;

        assert_eq!(join(task).await.unwrap_err().code(), expected);
        assert_eq!(registry.lock().await.connection_count(), 0);
        assert_eq!(
            timeout(TEST_TIMEOUT, read_json_frame(&mut client.reader))
                .await
                .unwrap()
                .unwrap(),
            None
        );
    }
}

#[tokio::test]
async fn rejects_wrong_version_direction_and_unhandled_application_messages() {
    let wrong_version = json!({
        "protocolVersion": 2,
        "type": "heartbeat",
        "heartbeatId": "wrong-version",
        "sentAt": "2026-09-15T00:00:00Z"
    });
    assert_ready_violation(
        serde_json::to_vec(&wrong_version).unwrap(),
        BrowserSessionErrorCode::InvalidMessage,
    )
    .await;

    let wrong_direction = Message::ToolCall(ToolCall {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".to_owned(),
        context_id: "tab-1".to_owned(),
        context_revision: 1,
        origin: "https://example.com".to_owned(),
        tool: "demo.read".to_owned(),
        args: Map::new(),
    });
    assert_ready_violation(
        serde_json::to_vec(&wrong_direction).unwrap(),
        BrowserSessionErrorCode::InvalidMessage,
    )
    .await;

    let snapshot = Message::CapabilitySnapshot(snapshot());
    assert_ready_violation(
        serde_json::to_vec(&snapshot).unwrap(),
        BrowserSessionErrorCode::ProtocolViolation,
    )
    .await;
}

#[tokio::test]
async fn handshake_and_heartbeat_deadlines_are_finite() {
    let registry = shared_capability_registry();
    let manager = BrowserSessionManager::with_config(
        registry.clone(),
        "deadline-test",
        BrowserSessionConfig {
            handshake_timeout: Duration::from_millis(20),
            heartbeat_timeout: Duration::from_millis(30),
            queue_capacity: NonZeroUsize::new(2).unwrap(),
        },
    );
    let (_idle_client, idle_task) = start_session(&manager, CancellationToken::new());
    assert_eq!(
        join(idle_task).await.unwrap_err().code(),
        BrowserSessionErrorCode::HandshakeTimeout
    );

    let (mut ready_client, ready_task) = start_session(&manager, CancellationToken::new());
    negotiate(&mut ready_client, vec![1]).await;
    wait_for_connections(&registry, 1).await;
    assert_eq!(
        join(ready_task).await.unwrap_err().code(),
        BrowserSessionErrorCode::HeartbeatTimeout
    );
    wait_for_connections(&registry, 0).await;
}

#[tokio::test]
async fn disconnect_removes_registry_state_and_revokes_pending_calls() {
    let registry = shared_capability_registry();
    let manager = manager(registry.clone(), Duration::from_secs(1));
    let (mut client, task) = start_session(&manager, CancellationToken::new());
    let connection_id = negotiate(&mut client, vec![1]).await;
    wait_for_connections(&registry, 1).await;

    let (routed, revocation) = {
        let mut registry = registry.lock().await;
        registry
            .replace_snapshot(&connection_id, snapshot())
            .unwrap();
        let routed = registry
            .route_call(ToolInvocation {
                request_id: "request-1".to_owned(),
                tool: "demo.read".to_owned(),
                arguments: Map::new(),
            })
            .unwrap();
        let revocation = routed.revocation();
        (routed, revocation)
    };
    assert!(!revocation.is_cancelled());
    routed.dispatch().await.unwrap();
    let payload = timeout(TEST_TIMEOUT, read_json_frame(&mut client.reader))
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let Message::ToolCall(call) = parse_message(&payload).unwrap() else {
        panic!("the route must reach the negotiated browser connection");
    };
    assert_eq!(call.request_id, "request-1");
    assert_eq!(call.context_id, "tab-1");

    drop(client);
    assert_eq!(join(task).await, Ok(()));
    assert!(revocation.is_cancelled());
    let registry = registry.lock().await;
    assert_eq!(registry.connection_count(), 0);
    assert!(registry.visible_capabilities().is_empty());
}

async fn assert_ready_violation(payload: Vec<u8>, expected: BrowserSessionErrorCode) {
    let registry = shared_capability_registry();
    let manager = manager(registry.clone(), Duration::from_secs(1));
    let (mut client, task) = start_session(&manager, CancellationToken::new());
    negotiate(&mut client, vec![1]).await;
    wait_for_connections(&registry, 1).await;
    write_json_frame(&mut client.writer, &payload)
        .await
        .unwrap();

    assert_eq!(join(task).await.unwrap_err().code(), expected);
    assert_eq!(registry.lock().await.connection_count(), 0);
}

fn manager(
    registry: mcpatch_bridge::routing::SharedCapabilityRegistry,
    heartbeat_timeout: Duration,
) -> BrowserSessionManager {
    BrowserSessionManager::with_config(
        registry,
        "test-namespace",
        BrowserSessionConfig {
            handshake_timeout: Duration::from_millis(100),
            heartbeat_timeout,
            queue_capacity: NonZeroUsize::new(2).unwrap(),
        },
    )
}

struct TestClient {
    reader: ReadHalf<DuplexStream>,
    writer: WriteHalf<DuplexStream>,
}

fn start_session(
    manager: &BrowserSessionManager,
    shutdown: CancellationToken,
) -> (TestClient, JoinHandle<Result<(), BrowserSessionError>>) {
    let (client, server) = tokio::io::duplex(64 * 1024);
    let (client_reader, client_writer) = tokio::io::split(client);
    let (server_reader, server_writer) = tokio::io::split(server);
    let manager = manager.clone();
    let task =
        tokio::spawn(async move { manager.run(server_reader, server_writer, shutdown).await });
    (
        TestClient {
            reader: client_reader,
            writer: client_writer,
        },
        task,
    )
}

async fn negotiate(
    client: &mut TestClient,
    versions: Vec<u32>,
) -> mcpatch_bridge::browser::BrowserConnectionId {
    send_message(client, hello(versions, Role::Extension)).await;
    let payload = timeout(TEST_TIMEOUT, read_json_frame(&mut client.reader))
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let Message::HelloAck(acknowledgement) = parse_message(&payload).unwrap() else {
        panic!("bridge must acknowledge the hello");
    };
    assert_eq!(acknowledgement.selected_protocol_version, PROTOCOL_VERSION);
    assert_eq!(acknowledgement.implementation.name, "mcpatch-bridge");
    mcpatch_bridge::browser::BrowserConnectionId::parse(acknowledgement.connection_id).unwrap()
}

async fn send_message(client: &mut TestClient, message: Message) {
    write_json_frame(&mut client.writer, &serde_json::to_vec(&message).unwrap())
        .await
        .unwrap();
}

fn hello(versions: Vec<u32>, role: Role) -> Message {
    Message::Hello(Hello {
        protocol_version: PROTOCOL_VERSION,
        role,
        supported_protocol_versions: versions,
        implementation: Implementation {
            name: "mcpatch-extension".to_owned(),
            version: "0.1.0".to_owned(),
        },
    })
}

fn heartbeat(id: &str) -> Message {
    Message::Heartbeat(Heartbeat {
        protocol_version: PROTOCOL_VERSION,
        heartbeat_id: id.to_owned(),
        sent_at: "2026-09-15T00:00:00Z".to_owned(),
    })
}

fn snapshot() -> CapabilitySnapshot {
    CapabilitySnapshot {
        protocol_version: PROTOCOL_VERSION,
        context_id: "tab-1".to_owned(),
        context_revision: 1,
        origin: "https://example.com".to_owned(),
        capabilities: vec![Capability {
            name: "demo.read".to_owned(),
            title: Some("Read demo state".to_owned()),
            description: "Return deterministic demo state.".to_owned(),
            origin: "https://example.com".to_owned(),
            source: CapabilitySource::NativeWebMcp,
            pack: None,
            risk: Risk::Read,
            permissions: vec![Permission::Read],
            input_schema: object(json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {}
            })),
            output_schema: Some(object(json!({"type": "object"}))),
        }],
    }
}

fn object(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

async fn wait_for_connections(
    registry: &mcpatch_bridge::routing::SharedCapabilityRegistry,
    expected: usize,
) {
    timeout(TEST_TIMEOUT, async {
        loop {
            if registry.lock().await.connection_count() == expected {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

async fn join(
    task: JoinHandle<Result<(), BrowserSessionError>>,
) -> Result<(), BrowserSessionError> {
    timeout(TEST_TIMEOUT, task).await.unwrap().unwrap()
}
