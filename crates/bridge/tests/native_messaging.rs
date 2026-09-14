use std::{sync::Arc, time::Duration};

use futures_util::future::BoxFuture;
use mcpatch_bridge::{
    native_host::{
        CallerOriginPolicy, ExactCallerOriginPolicy, ExtensionOrigin, LocalBrowserChannel,
        LocalBrowserChannelError, LocalBrowserChannelErrorCode, MAX_NATIVE_MESSAGE_BYTES,
        NativeMessageErrorCode, read_message, run, write_message,
    },
    protocol::{Heartbeat, Message, PROTOCOL_VERSION, ToolResult},
};
use serde_json::json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, mpsc},
    time::timeout,
};

const TEST_TIMEOUT: Duration = Duration::from_secs(2);
const ALLOWED_ORIGIN: &str = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/";

#[tokio::test]
async fn reads_and_writes_native_endian_protocol_frames() {
    let message = heartbeat("browser-heartbeat");
    let payload = serde_json::to_vec(&message).unwrap();
    let (mut browser_output, mut host_input) = tokio::io::duplex(4096);

    browser_output
        .write_all(&u32::try_from(payload.len()).unwrap().to_ne_bytes())
        .await
        .unwrap();
    browser_output.write_all(&payload).await.unwrap();
    assert_eq!(
        read_message(&mut host_input)
            .await
            .expect("valid frame must decode"),
        Some(message.clone())
    );

    drop(browser_output);
    assert_eq!(
        read_message(&mut host_input)
            .await
            .expect("clean EOF must not be an error"),
        None
    );

    let (mut host_output, mut browser_input) = tokio::io::duplex(4096);
    write_message(&mut host_output, &message)
        .await
        .expect("valid message must encode");
    let mut header = [0_u8; 4];
    browser_input.read_exact(&mut header).await.unwrap();
    let encoded_length = usize::try_from(u32::from_ne_bytes(header)).unwrap();
    let mut encoded_payload = vec![0_u8; encoded_length];
    browser_input
        .read_exact(&mut encoded_payload)
        .await
        .unwrap();
    assert_eq!(encoded_payload, payload);
}

#[tokio::test]
async fn rejects_an_oversized_length_before_waiting_for_a_payload() {
    let (mut sender, mut receiver) = tokio::io::duplex(16);
    sender
        .write_all(
            &u32::try_from(MAX_NATIVE_MESSAGE_BYTES + 1)
                .unwrap()
                .to_ne_bytes(),
        )
        .await
        .unwrap();

    let error = timeout(TEST_TIMEOUT, read_message(&mut receiver))
        .await
        .expect("reader must reject the prefix immediately")
        .expect_err("oversized frame must fail");
    assert_eq!(error.code(), NativeMessageErrorCode::MessageTooLarge);
}

#[tokio::test]
async fn rejects_zero_truncated_and_malformed_frames() {
    assert_frame_error(&0_u32.to_ne_bytes(), NativeMessageErrorCode::EmptyMessage).await;
    assert_frame_error(&[1, 2], NativeMessageErrorCode::TruncatedHeader).await;

    let mut truncated_payload = 4_u32.to_ne_bytes().to_vec();
    truncated_payload.extend_from_slice(b"{}");
    assert_frame_error(&truncated_payload, NativeMessageErrorCode::TruncatedPayload).await;

    let mut malformed = 2_u32.to_ne_bytes().to_vec();
    malformed.extend_from_slice(b"{}");
    assert_frame_error(&malformed, NativeMessageErrorCode::InvalidProtocol).await;
}

#[tokio::test]
async fn refuses_to_emit_oversized_messages() {
    let message = Message::ToolResult(ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: "request-1".into(),
        context_id: "context-1".into(),
        context_revision: 1,
        origin: "https://example.com".into(),
        result: json!("x".repeat(MAX_NATIVE_MESSAGE_BYTES)),
    });
    let mut sink = tokio::io::sink();

    let error = write_message(&mut sink, &message)
        .await
        .expect_err("oversized output must fail");
    assert_eq!(error.code(), NativeMessageErrorCode::MessageTooLarge);
}

#[test]
fn caller_origin_policy_is_canonical_and_exact() {
    let policy = ExactCallerOriginPolicy::new(ALLOWED_ORIGIN).expect("origin must be valid");
    let allowed = ExtensionOrigin::parse(ALLOWED_ORIGIN).expect("origin must be valid");
    assert!(policy.authorize(&allowed).is_ok());

    let other = ExtensionOrigin::parse("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/")
        .expect("other origin must be syntactically valid");
    assert!(policy.authorize(&other).is_err());

    for invalid in [
        "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1/",
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/path",
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/?query=1",
    ] {
        assert!(
            ExtensionOrigin::parse(invalid).is_err(),
            "accepted {invalid}"
        );
    }
}

#[tokio::test]
async fn runtime_relays_typed_messages_in_both_directions() {
    let policy = ExactCallerOriginPolicy::new(ALLOWED_ORIGIN).unwrap();
    let (channel, mut from_browser, to_browser) = FakeLocalChannel::new();
    let (mut browser_input, host_input) = tokio::io::duplex(4096);
    let (host_output, mut browser_output) = tokio::io::duplex(4096);

    let runtime = tokio::spawn(run(
        ALLOWED_ORIGIN,
        host_input,
        host_output,
        policy,
        channel.clone(),
    ));

    let inbound = heartbeat("from-browser");
    write_message(&mut browser_input, &inbound).await.unwrap();
    assert_eq!(
        timeout(TEST_TIMEOUT, from_browser.recv()).await.unwrap(),
        Some(inbound)
    );

    let outbound = heartbeat("to-browser");
    to_browser.send(outbound.clone()).await.unwrap();
    assert_eq!(
        timeout(TEST_TIMEOUT, read_message(&mut browser_output))
            .await
            .unwrap()
            .unwrap(),
        Some(outbound)
    );

    drop(browser_input);
    timeout(TEST_TIMEOUT, runtime)
        .await
        .expect("runtime must stop on browser EOF")
        .expect("runtime task must not panic")
        .expect("clean browser EOF must succeed");
    assert!(channel.closed().await);
}

async fn assert_frame_error(frame: &[u8], expected: NativeMessageErrorCode) {
    let (mut sender, mut receiver) = tokio::io::duplex(frame.len().max(1));
    sender.write_all(frame).await.unwrap();
    drop(sender);
    let error = read_message(&mut receiver)
        .await
        .expect_err("invalid frame must fail");
    assert_eq!(error.code(), expected);
}

fn heartbeat(id: &str) -> Message {
    Message::Heartbeat(Heartbeat {
        protocol_version: PROTOCOL_VERSION,
        heartbeat_id: id.into(),
        sent_at: "2026-09-15T00:00:00Z".into(),
    })
}

struct FakeLocalChannel {
    inbound: mpsc::Sender<Message>,
    outbound: Mutex<mpsc::Receiver<Message>>,
    closed: Mutex<bool>,
}

impl FakeLocalChannel {
    fn new() -> (Arc<Self>, mpsc::Receiver<Message>, mpsc::Sender<Message>) {
        let (inbound, from_browser) = mpsc::channel(4);
        let (to_browser, outbound) = mpsc::channel(4);
        (
            Arc::new(Self {
                inbound,
                outbound: Mutex::new(outbound),
                closed: Mutex::new(false),
            }),
            from_browser,
            to_browser,
        )
    }

    async fn closed(&self) -> bool {
        *self.closed.lock().await
    }
}

impl LocalBrowserChannel for FakeLocalChannel {
    fn send(&self, message: Message) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>> {
        Box::pin(async move {
            self.inbound
                .send(message)
                .await
                .map_err(|_| LocalBrowserChannelError::new(LocalBrowserChannelErrorCode::Closed))
        })
    }

    fn receive(&self) -> BoxFuture<'_, Result<Option<Message>, LocalBrowserChannelError>> {
        Box::pin(async move { Ok(self.outbound.lock().await.recv().await) })
    }

    fn close(&self) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>> {
        Box::pin(async move {
            *self.closed.lock().await = true;
            Ok(())
        })
    }
}
