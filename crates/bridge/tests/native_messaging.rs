use std::{
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    task::{Context, Poll},
    time::Duration,
};

use futures_util::future::BoxFuture;
use mcpatch_bridge::{
    native_host::{
        CallerOriginPolicy, ExactCallerOriginPolicy, ExtensionOrigin, LocalBrowserChannel,
        LocalBrowserChannelError, LocalBrowserChannelErrorCode, LocalBrowserChannelFactory,
        MAX_NATIVE_MESSAGE_BYTES, NativeMessageErrorCode, read_message, run, write_message,
    },
    protocol::{Heartbeat, Message, PROTOCOL_VERSION, ToolResult},
};
use serde_json::json;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt, ReadBuf},
    sync::{Mutex, Notify, mpsc},
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

    let factory = ReadyChannelFactory::new(channel.clone());
    let runtime = tokio::spawn(run(
        ALLOWED_ORIGIN,
        host_input,
        host_output,
        policy,
        factory.clone(),
    ));

    let inbound = heartbeat("from-browser");
    write_message(&mut browser_input, &inbound).await.unwrap();
    assert_eq!(
        timeout(TEST_TIMEOUT, from_browser.recv()).await.unwrap(),
        Some(inbound)
    );

    let outbound = heartbeat("to-browser");
    to_browser.send(Ok(outbound.clone())).await.unwrap();
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
    assert_eq!(factory.calls(), 1);
}

#[tokio::test]
async fn local_message_does_not_cancel_a_partial_browser_frame() {
    let policy = ExactCallerOriginPolicy::new(ALLOWED_ORIGIN).unwrap();
    let (channel, mut from_browser, to_browser) = FakeLocalChannel::new();
    let factory = ReadyChannelFactory::new(channel.clone());
    let (mut browser_input, host_input) = tokio::io::duplex(4096);
    let (host_output, mut browser_output) = tokio::io::duplex(4096);
    let bytes_read = Arc::new(AtomicUsize::new(0));
    let read_progress = Arc::new(Notify::new());
    let tracked_input = TrackingReader::new(
        host_input,
        Arc::clone(&bytes_read),
        Arc::clone(&read_progress),
    );
    let runtime = tokio::spawn(run(
        ALLOWED_ORIGIN,
        tracked_input,
        host_output,
        policy,
        factory,
    ));

    let first = heartbeat("first-message");
    let first_frame_len = serde_json::to_vec(&first).unwrap().len() + size_of::<u32>();
    write_message(&mut browser_input, &first).await.unwrap();
    assert_eq!(from_browser.recv().await, Some(first));

    let second = heartbeat("partial-browser-message");
    let second_payload = serde_json::to_vec(&second).unwrap();
    let second_header = u32::try_from(second_payload.len()).unwrap().to_ne_bytes();
    browser_input.write_all(&second_header[..2]).await.unwrap();
    wait_for_read_progress(&bytes_read, &read_progress, first_frame_len + 2).await;

    let outbound = heartbeat("from-core-during-partial-read");
    to_browser.send(Ok(outbound.clone())).await.unwrap();
    assert_eq!(
        timeout(TEST_TIMEOUT, read_message(&mut browser_output))
            .await
            .unwrap()
            .unwrap(),
        Some(outbound)
    );

    browser_input.write_all(&second_header[2..]).await.unwrap();
    browser_input.write_all(&second_payload).await.unwrap();
    assert_eq!(
        timeout(TEST_TIMEOUT, from_browser.recv()).await.unwrap(),
        Some(second)
    );
    drop(browser_input);
    timeout(TEST_TIMEOUT, runtime)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(channel.closed().await);
}

#[tokio::test]
async fn rejects_the_caller_before_reading_or_rendezvous() {
    let policy = ExactCallerOriginPolicy::new(ALLOWED_ORIGIN).unwrap();
    let factory = FailingChannelFactory::new(LocalBrowserChannelErrorCode::Unavailable);

    let error = run(
        "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/",
        PanicReader,
        tokio::io::sink(),
        policy,
        factory.clone(),
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), "caller_origin_unauthorized");
    assert_eq!(factory.calls(), 0);
}

#[tokio::test]
async fn reports_startup_unavailable_after_the_first_validated_message() {
    let policy = ExactCallerOriginPolicy::new(ALLOWED_ORIGIN).unwrap();
    let factory = FailingChannelFactory::new(LocalBrowserChannelErrorCode::Unavailable);
    let (mut browser_input, host_input) = tokio::io::duplex(4096);

    write_message(&mut browser_input, &heartbeat("first-message"))
        .await
        .unwrap();
    let error = run(
        ALLOWED_ORIGIN,
        host_input,
        tokio::io::sink(),
        policy,
        factory.clone(),
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), "local_core_unavailable");
    assert_eq!(factory.calls(), 1);
}

#[tokio::test]
async fn terminates_and_closes_the_channel_on_local_ipc_loss() {
    let policy = ExactCallerOriginPolicy::new(ALLOWED_ORIGIN).unwrap();
    let (channel, mut from_browser, to_browser) = FakeLocalChannel::new();
    let factory = ReadyChannelFactory::new(channel.clone());
    let (mut browser_input, host_input) = tokio::io::duplex(4096);

    let runtime = tokio::spawn(run(
        ALLOWED_ORIGIN,
        host_input,
        tokio::io::sink(),
        policy,
        factory,
    ));
    write_message(&mut browser_input, &heartbeat("first-message"))
        .await
        .unwrap();
    assert!(from_browser.recv().await.is_some());
    to_browser
        .send(Err(LocalBrowserChannelError::new(
            LocalBrowserChannelErrorCode::Closed,
        )))
        .await
        .unwrap();

    let error = timeout(TEST_TIMEOUT, runtime)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code(), "local_ipc_closed");
    assert!(channel.closed().await);
}

#[tokio::test]
async fn malformed_browser_data_after_connect_closes_the_local_side() {
    let policy = ExactCallerOriginPolicy::new(ALLOWED_ORIGIN).unwrap();
    let (channel, mut from_browser, _to_browser) = FakeLocalChannel::new();
    let factory = ReadyChannelFactory::new(channel.clone());
    let (mut browser_input, host_input) = tokio::io::duplex(4096);

    let runtime = tokio::spawn(run(
        ALLOWED_ORIGIN,
        host_input,
        tokio::io::sink(),
        policy,
        factory,
    ));
    write_message(&mut browser_input, &heartbeat("first-message"))
        .await
        .unwrap();
    assert!(from_browser.recv().await.is_some());
    browser_input.write_all(&2_u32.to_ne_bytes()).await.unwrap();
    browser_input.write_all(b"{}").await.unwrap();

    let error = timeout(TEST_TIMEOUT, runtime)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code(), "native_message_invalid_protocol");
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
    outbound: Mutex<mpsc::Receiver<Result<Message, LocalBrowserChannelError>>>,
    closed: Mutex<bool>,
}

impl FakeLocalChannel {
    fn new() -> (
        Arc<Self>,
        mpsc::Receiver<Message>,
        mpsc::Sender<Result<Message, LocalBrowserChannelError>>,
    ) {
        let (inbound, from_browser) = mpsc::channel(1);
        let (to_browser, outbound) = mpsc::channel(1);
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
        Box::pin(async move { self.outbound.lock().await.recv().await.transpose() })
    }

    fn close(&self) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>> {
        Box::pin(async move {
            *self.closed.lock().await = true;
            Ok(())
        })
    }
}

#[derive(Clone)]
struct ReadyChannelFactory {
    channel: Arc<FakeLocalChannel>,
    calls: Arc<AtomicUsize>,
}

impl ReadyChannelFactory {
    fn new(channel: Arc<FakeLocalChannel>) -> Self {
        Self {
            channel,
            calls: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::Acquire)
    }
}

impl LocalBrowserChannelFactory for ReadyChannelFactory {
    fn connect(
        &self,
    ) -> BoxFuture<'_, Result<Arc<dyn LocalBrowserChannel>, LocalBrowserChannelError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::AcqRel);
            let channel: Arc<dyn LocalBrowserChannel> = self.channel.clone();
            Ok(channel)
        })
    }
}

#[derive(Clone)]
struct FailingChannelFactory {
    code: LocalBrowserChannelErrorCode,
    calls: Arc<AtomicUsize>,
}

impl FailingChannelFactory {
    fn new(code: LocalBrowserChannelErrorCode) -> Self {
        Self {
            code,
            calls: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::Acquire)
    }
}

impl LocalBrowserChannelFactory for FailingChannelFactory {
    fn connect(
        &self,
    ) -> BoxFuture<'_, Result<Arc<dyn LocalBrowserChannel>, LocalBrowserChannelError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::AcqRel);
            Err(LocalBrowserChannelError::new(self.code))
        })
    }
}

struct PanicReader;

impl AsyncRead for PanicReader {
    fn poll_read(
        self: Pin<&mut Self>,
        _context: &mut Context<'_>,
        _buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        panic!("browser input was read before caller authorization")
    }
}

struct TrackingReader<R> {
    inner: R,
    bytes_read: Arc<AtomicUsize>,
    read_progress: Arc<Notify>,
}

impl<R> TrackingReader<R> {
    fn new(inner: R, bytes_read: Arc<AtomicUsize>, read_progress: Arc<Notify>) -> Self {
        Self {
            inner,
            bytes_read,
            read_progress,
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for TrackingReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buffer.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(context, buffer);
        if matches!(result, Poll::Ready(Ok(()))) {
            let count = buffer.filled().len() - before;
            if count > 0 {
                self.bytes_read.fetch_add(count, Ordering::AcqRel);
                self.read_progress.notify_waiters();
            }
        }
        result
    }
}

async fn wait_for_read_progress(bytes_read: &AtomicUsize, read_progress: &Notify, expected: usize) {
    timeout(TEST_TIMEOUT, async {
        loop {
            let notified = read_progress.notified();
            if bytes_read.load(Ordering::Acquire) >= expected {
                return;
            }
            notified.await;
        }
    })
    .await
    .expect("browser frame prefix must be consumed before local delivery");
}
