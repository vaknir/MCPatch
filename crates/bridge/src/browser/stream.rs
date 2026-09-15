use std::{num::NonZeroUsize, sync::Arc};

use futures_util::future::BoxFuture;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    sync::{Mutex, mpsc},
};
use tokio_util::sync::CancellationToken;

use super::{
    BrowserConnection, BrowserConnectionError, BrowserConnectionErrorCode, BrowserConnectionId,
};
use crate::{
    local_ipc::{
        LocalFrameError, LocalFrameErrorCode, read_json_frame_with_partial_timeout,
        write_json_frame,
    },
    mcp::PARTIAL_LOCAL_FRAME_TIMEOUT,
    protocol::{AcceptorNegotiation, Message, NegotiationEvent, parse_message},
};

pub(super) struct StreamBrowserConnection {
    id: BrowserConnectionId,
    protocol_version: u32,
    outbound: Mutex<Option<mpsc::Sender<Message>>>,
    inbound: Mutex<mpsc::Receiver<Message>>,
    closed: CancellationToken,
}

pub(super) struct StreamBrowserDriver<R, W> {
    reader: R,
    writer: W,
    negotiation: AcceptorNegotiation,
    outbound: mpsc::Receiver<Message>,
    inbound: mpsc::Sender<Message>,
    closed: CancellationToken,
}

pub(super) fn stream_browser_connection<R, W>(
    id: BrowserConnectionId,
    protocol_version: u32,
    reader: R,
    writer: W,
    negotiation: AcceptorNegotiation,
    capacity: NonZeroUsize,
) -> (Arc<StreamBrowserConnection>, StreamBrowserDriver<R, W>) {
    let (to_driver, outbound) = mpsc::channel(capacity.get());
    let (inbound, from_driver) = mpsc::channel(capacity.get());
    let closed = CancellationToken::new();

    (
        Arc::new(StreamBrowserConnection {
            id,
            protocol_version,
            outbound: Mutex::new(Some(to_driver)),
            inbound: Mutex::new(from_driver),
            closed: closed.clone(),
        }),
        StreamBrowserDriver {
            reader,
            writer,
            negotiation,
            outbound,
            inbound,
            closed,
        },
    )
}

impl BrowserConnection for StreamBrowserConnection {
    fn id(&self) -> &BrowserConnectionId {
        &self.id
    }

    fn send(&self, message: Message) -> BoxFuture<'_, Result<(), BrowserConnectionError>> {
        Box::pin(async move {
            if message.validate().is_err()
                || message_protocol_version(&message) != self.protocol_version
                || !is_bridge_application_message(&message)
            {
                self.closed.cancel();
                return Err(connection_error(BrowserConnectionErrorCode::InvalidMessage));
            }
            if self.closed.is_cancelled() {
                return Err(connection_error(BrowserConnectionErrorCode::Closed));
            }

            let outbound = self.outbound.lock().await;
            let sender = outbound
                .as_ref()
                .ok_or_else(|| connection_error(BrowserConnectionErrorCode::Closed))?;
            sender.try_send(message).map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => {
                    self.closed.cancel();
                    connection_error(BrowserConnectionErrorCode::Backpressure)
                }
                mpsc::error::TrySendError::Closed(_) => {
                    connection_error(BrowserConnectionErrorCode::Closed)
                }
            })
        })
    }

    fn receive(&self) -> BoxFuture<'_, Result<Option<Message>, BrowserConnectionError>> {
        Box::pin(async move {
            let mut inbound = self.inbound.lock().await;
            tokio::select! {
                biased;
                _ = self.closed.cancelled() => Ok(None),
                message = inbound.recv() => Ok(message),
            }
        })
    }

    fn close(&self) -> BoxFuture<'_, Result<(), BrowserConnectionError>> {
        Box::pin(async move {
            self.closed.cancel();
            self.outbound.lock().await.take();
            Ok(())
        })
    }
}

impl<R, W> StreamBrowserDriver<R, W>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    pub(super) async fn run(mut self) -> Result<(), BrowserConnectionError> {
        let result = self.run_inner().await;
        self.closed.cancel();
        result
    }

    async fn run_inner(&mut self) -> Result<(), BrowserConnectionError> {
        loop {
            tokio::select! {
                biased;
                () = self.closed.cancelled() => return Ok(()),
                inbound = read_json_frame_with_partial_timeout(
                    &mut self.reader,
                    PARTIAL_LOCAL_FRAME_TIMEOUT,
                ) => {
                    let Some(payload) = inbound.map_err(map_frame_error)? else {
                        return Ok(());
                    };
                    let message = parse_message(&payload).map_err(|_| connection_error(
                        BrowserConnectionErrorCode::InvalidMessage,
                    ))?;
                    if !matches!(
                        self.negotiation.receive(&message),
                        Ok(NegotiationEvent::MessageAccepted)
                    ) || !is_extension_application_message(&message) {
                        return Err(connection_error(BrowserConnectionErrorCode::InvalidMessage));
                    }
                    self.inbound.try_send(message).map_err(|error| match error {
                        mpsc::error::TrySendError::Full(_) => connection_error(
                            BrowserConnectionErrorCode::Backpressure,
                        ),
                        mpsc::error::TrySendError::Closed(_) => connection_error(
                            BrowserConnectionErrorCode::Closed,
                        ),
                    })?;
                }
                outbound = self.outbound.recv() => {
                    let Some(message) = outbound else {
                        return Ok(());
                    };
                    let payload = serde_json::to_vec(&message).map_err(|_| connection_error(
                        BrowserConnectionErrorCode::InvalidMessage,
                    ))?;
                    write_json_frame(&mut self.writer, &payload).await.map_err(|_| {
                        connection_error(BrowserConnectionErrorCode::Transport)
                    })?;
                }
            }
        }
    }
}

fn is_extension_application_message(message: &Message) -> bool {
    matches!(
        message,
        Message::CapabilitySnapshot(_)
            | Message::ContextClosed(_)
            | Message::ToolResult(_)
            | Message::ToolError(_)
            | Message::ApprovalResult(_)
            | Message::Heartbeat(_)
            | Message::ConnectionError(_)
    )
}

fn is_bridge_application_message(message: &Message) -> bool {
    matches!(
        message,
        Message::ToolCall(_)
            | Message::Cancel(_)
            | Message::ApprovalRequired(_)
            | Message::Heartbeat(_)
            | Message::ConnectionError(_)
    )
}

fn message_protocol_version(message: &Message) -> u32 {
    match message {
        Message::Hello(value) => value.protocol_version,
        Message::HelloAck(value) => value.protocol_version,
        Message::CapabilitySnapshot(value) => value.protocol_version,
        Message::ContextClosed(value) => value.protocol_version,
        Message::ToolCall(value) => value.protocol_version,
        Message::ToolResult(value) => value.protocol_version,
        Message::ToolError(value) => value.protocol_version,
        Message::Cancel(value) => value.protocol_version,
        Message::ApprovalRequired(value) => value.protocol_version,
        Message::ApprovalResult(value) => value.protocol_version,
        Message::Heartbeat(value) => value.protocol_version,
        Message::ConnectionError(value) => value.protocol_version,
    }
}

const fn connection_error(code: BrowserConnectionErrorCode) -> BrowserConnectionError {
    BrowserConnectionError::new(code)
}

fn map_frame_error(error: LocalFrameError) -> BrowserConnectionError {
    let code = match error.code() {
        LocalFrameErrorCode::EmptyMessage
        | LocalFrameErrorCode::InvalidJson
        | LocalFrameErrorCode::MessageTooLarge
        | LocalFrameErrorCode::TruncatedHeader
        | LocalFrameErrorCode::TruncatedPayload => BrowserConnectionErrorCode::InvalidMessage,
        LocalFrameErrorCode::ReadFailed | LocalFrameErrorCode::WriteFailed => {
            BrowserConnectionErrorCode::Transport
        }
    };
    connection_error(code)
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroUsize;

    use super::*;
    use crate::protocol::{Heartbeat, Hello, Implementation, PROTOCOL_VERSION, Role};

    #[tokio::test]
    async fn outbound_queue_is_bounded_before_the_driver_can_drain_it() {
        let (stream, _peer) = tokio::io::duplex(64);
        let (reader, writer) = tokio::io::split(stream);
        let (connection, _driver) = stream_browser_connection(
            BrowserConnectionId::parse("browser.test.1").unwrap(),
            PROTOCOL_VERSION,
            reader,
            writer,
            ready_negotiation(),
            NonZeroUsize::new(1).unwrap(),
        );

        connection.send(heartbeat("first")).await.unwrap();
        let error = connection.send(heartbeat("second")).await.unwrap_err();
        assert_eq!(error.code(), BrowserConnectionErrorCode::Backpressure);
        assert_eq!(connection.receive().await.unwrap(), None);
    }

    #[tokio::test]
    async fn invalid_outbound_direction_closes_the_connection() {
        let (stream, _peer) = tokio::io::duplex(64);
        let (reader, writer) = tokio::io::split(stream);
        let (connection, _driver) = stream_browser_connection(
            BrowserConnectionId::parse("browser.test.1").unwrap(),
            PROTOCOL_VERSION,
            reader,
            writer,
            ready_negotiation(),
            NonZeroUsize::new(1).unwrap(),
        );

        let error = connection
            .send(Message::Hello(Hello {
                protocol_version: PROTOCOL_VERSION,
                role: Role::Bridge,
                supported_protocol_versions: vec![PROTOCOL_VERSION],
                implementation: Implementation {
                    name: "mcpatch-bridge".to_owned(),
                    version: "0.1.0".to_owned(),
                },
            }))
            .await
            .unwrap_err();
        assert_eq!(error.code(), BrowserConnectionErrorCode::InvalidMessage);
        assert_eq!(connection.receive().await.unwrap(), None);
    }

    fn ready_negotiation() -> AcceptorNegotiation {
        let mut negotiation = AcceptorNegotiation::new(vec![PROTOCOL_VERSION]).unwrap();
        let hello = Message::Hello(Hello {
            protocol_version: PROTOCOL_VERSION,
            role: Role::Extension,
            supported_protocol_versions: vec![PROTOCOL_VERSION],
            implementation: Implementation {
                name: "mcpatch-extension".to_owned(),
                version: "0.1.0".to_owned(),
            },
        });
        assert!(matches!(
            negotiation.receive(&hello).unwrap(),
            NegotiationEvent::SendHelloAck { .. }
        ));
        negotiation.acknowledgement_sent().unwrap();
        negotiation
    }

    fn heartbeat(id: &str) -> Message {
        Message::Heartbeat(Heartbeat {
            protocol_version: PROTOCOL_VERSION,
            heartbeat_id: id.to_owned(),
            sent_at: "2026-09-15T00:00:00Z".to_owned(),
        })
    }
}
