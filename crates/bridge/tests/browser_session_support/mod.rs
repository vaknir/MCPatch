use std::{num::NonZeroUsize, time::Duration};

use mcpatch_bridge::{
    browser::{BrowserSessionConfig, BrowserSessionError, BrowserSessionManager},
    local_ipc::{read_json_frame, write_json_frame},
    protocol::{
        Capability, CapabilitySnapshot, CapabilitySource, Hello, Implementation, Message,
        PROTOCOL_VERSION, PackReference, Permission, Risk, Role, parse_message,
    },
    routing::SharedCapabilityRegistry,
};
use serde_json::{Map, Value, json};
use tokio::{
    io::{DuplexStream, ReadHalf, WriteHalf},
    task::JoinHandle,
    time::timeout,
};
use tokio_util::sync::CancellationToken;

pub const TEST_TIMEOUT: Duration = Duration::from_secs(2);

pub fn manager(
    registry: SharedCapabilityRegistry,
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

pub struct TestClient {
    pub reader: ReadHalf<DuplexStream>,
    pub writer: WriteHalf<DuplexStream>,
}

pub fn start_session(
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

pub async fn negotiate(
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
    assert_eq!(
        acknowledgement.supported_protocol_versions,
        vec![PROTOCOL_VERSION]
    );
    assert_eq!(acknowledgement.selected_protocol_version, PROTOCOL_VERSION);
    assert_eq!(acknowledgement.implementation.name, "mcpatch-bridge");
    mcpatch_bridge::browser::BrowserConnectionId::parse(acknowledgement.connection_id).unwrap()
}

pub async fn send_message(client: &mut TestClient, message: Message) {
    write_json_frame(&mut client.writer, &serde_json::to_vec(&message).unwrap())
        .await
        .unwrap();
}

pub fn hello(versions: Vec<u32>, role: Role) -> Message {
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

pub fn snapshot() -> CapabilitySnapshot {
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
            source: CapabilitySource::Pack,
            pack: Some(PackReference {
                publisher: "mcpatch".to_owned(),
                id: "test-pack".to_owned(),
                version: "0.1.0".to_owned(),
                digest: format!("sha256:{}", "a".repeat(64)),
            }),
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

pub async fn join(
    task: JoinHandle<Result<(), BrowserSessionError>>,
) -> Result<(), BrowserSessionError> {
    timeout(TEST_TIMEOUT, task).await.unwrap().unwrap()
}
