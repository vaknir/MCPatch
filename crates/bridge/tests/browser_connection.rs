use std::{num::NonZeroUsize, sync::Arc};

use mcpatch_bridge::{
    browser::{
        BrowserConnection, BrowserConnectionErrorCode, BrowserConnectionId, fake_browser_connection,
    },
    protocol::{Cancel, Message, PROTOCOL_VERSION},
};

#[tokio::test]
async fn fake_connection_exchanges_typed_messages_in_order() {
    let id = BrowserConnectionId::parse("connection-test").expect("id must be valid");
    let (connection, browser) = fake_browser_connection(
        id.clone(),
        NonZeroUsize::new(2).expect("capacity must be non-zero"),
    );
    let connection: Arc<dyn BrowserConnection> = connection;

    assert_eq!(connection.id(), &id);

    browser
        .send_to_bridge(cancel("browser-1"))
        .await
        .expect("browser message must enqueue");
    browser
        .send_to_bridge(cancel("browser-2"))
        .await
        .expect("browser message must enqueue");
    assert_eq!(
        connection.receive().await.expect("receive must succeed"),
        Some(cancel("browser-1"))
    );
    assert_eq!(
        connection.receive().await.expect("receive must succeed"),
        Some(cancel("browser-2"))
    );

    connection
        .send(cancel("bridge-1"))
        .await
        .expect("bridge message must enqueue");
    assert_eq!(
        browser
            .receive_from_bridge()
            .await
            .expect("receive must succeed"),
        Some(cancel("bridge-1"))
    );
}

#[tokio::test]
async fn fake_connection_rejects_invalid_typed_messages_at_both_boundaries() {
    let (connection, browser) = fake_browser_connection(
        BrowserConnectionId::parse("connection-test").expect("id must be valid"),
        NonZeroUsize::new(1).expect("capacity must be non-zero"),
    );
    let invalid = Message::Cancel(Cancel {
        protocol_version: PROTOCOL_VERSION + 1,
        request_id: "request-1".to_owned(),
    });

    assert_eq!(
        connection
            .send(invalid.clone())
            .await
            .expect_err("bridge must reject an invalid message")
            .code(),
        BrowserConnectionErrorCode::InvalidMessage
    );
    assert_eq!(
        browser
            .send_to_bridge(invalid)
            .await
            .expect_err("browser must reject an invalid message")
            .code(),
        BrowserConnectionErrorCode::InvalidMessage
    );
}

#[tokio::test]
async fn fake_connection_applies_bounded_backpressure() {
    let (connection, browser) = fake_browser_connection(
        BrowserConnectionId::parse("connection-test").expect("id must be valid"),
        NonZeroUsize::new(1).expect("capacity must be non-zero"),
    );

    connection
        .send(cancel("bridge-1"))
        .await
        .expect("first message must enqueue");
    assert_eq!(
        connection
            .send(cancel("bridge-2"))
            .await
            .expect_err("full queue must reject without waiting")
            .code(),
        BrowserConnectionErrorCode::Backpressure
    );

    browser
        .send_to_bridge(cancel("browser-1"))
        .await
        .expect("first message must enqueue");
    assert_eq!(
        browser
            .send_to_bridge(cancel("browser-2"))
            .await
            .expect_err("full queue must reject without waiting")
            .code(),
        BrowserConnectionErrorCode::Backpressure
    );
}

#[tokio::test]
async fn closing_is_idempotent_and_disconnects_both_directions() {
    let (connection, browser) = fake_browser_connection(
        BrowserConnectionId::parse("connection-test").expect("id must be valid"),
        NonZeroUsize::new(1).expect("capacity must be non-zero"),
    );

    connection.close().await.expect("first close must succeed");
    connection.close().await.expect("second close must succeed");

    assert_eq!(
        connection.receive().await.expect("receive must succeed"),
        None
    );
    assert_eq!(
        browser
            .receive_from_bridge()
            .await
            .expect("receive must succeed"),
        None
    );
    assert_eq!(
        connection
            .send(cancel("after-close"))
            .await
            .expect_err("closed connection must reject sends")
            .code(),
        BrowserConnectionErrorCode::Closed
    );
    assert_eq!(
        browser
            .send_to_bridge(cancel("after-close"))
            .await
            .expect_err("closed peer must reject sends")
            .code(),
        BrowserConnectionErrorCode::Closed
    );
}

#[tokio::test]
async fn dropping_the_browser_peer_reports_disconnect() {
    let (connection, browser) = fake_browser_connection(
        BrowserConnectionId::parse("connection-test").expect("id must be valid"),
        NonZeroUsize::new(1).expect("capacity must be non-zero"),
    );

    drop(browser);

    assert_eq!(
        connection.receive().await.expect("receive must succeed"),
        None
    );
    assert_eq!(
        connection
            .send(cancel("after-disconnect"))
            .await
            .expect_err("disconnected peer must reject sends")
            .code(),
        BrowserConnectionErrorCode::Closed
    );
}

#[test]
fn connection_ids_match_protocol_identifier_rules() {
    assert!(BrowserConnectionId::parse("connection-01J8QAZ6V4F2K7M3").is_ok());
    assert!(BrowserConnectionId::parse("").is_err());
    assert!(BrowserConnectionId::parse("connection id").is_err());
    assert!(BrowserConnectionId::parse("é").is_err());
    assert!(BrowserConnectionId::parse("x".repeat(129)).is_err());
}

fn cancel(request_id: &str) -> Message {
    Message::Cancel(Cancel {
        protocol_version: PROTOCOL_VERSION,
        request_id: request_id.to_owned(),
    })
}
