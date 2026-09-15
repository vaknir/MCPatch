use std::{
    fmt,
    num::NonZeroUsize,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use thiserror::Error;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    time::{Instant, timeout},
};
use tokio_util::sync::CancellationToken;

use super::{
    BrowserConnection, BrowserConnectionErrorCode, BrowserConnectionId,
    stream::stream_browser_connection,
};
use crate::{
    PRODUCT_VERSION,
    local_ipc::{
        LocalFrameError, LocalFrameErrorCode, read_json_frame_with_partial_timeout,
        write_json_frame,
    },
    mcp::PARTIAL_LOCAL_FRAME_TIMEOUT,
    protocol::{
        AcceptorNegotiation, HelloAck, Implementation, Message, NegotiationEvent, PROTOCOL_VERSION,
        Role, parse_message,
    },
    routing::SharedCapabilityRegistry,
};

const SUPPORTED_PROTOCOL_VERSIONS: &[u32] = &[PROTOCOL_VERSION];
const DEFAULT_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);
const DEFAULT_QUEUE_CAPACITY: NonZeroUsize = NonZeroUsize::new(16).unwrap();

#[derive(Clone, Copy, Debug)]
pub struct BrowserSessionConfig {
    pub handshake_timeout: Duration,
    pub heartbeat_timeout: Duration,
    pub queue_capacity: NonZeroUsize,
}

impl Default for BrowserSessionConfig {
    fn default() -> Self {
        Self {
            handshake_timeout: DEFAULT_HANDSHAKE_TIMEOUT,
            heartbeat_timeout: DEFAULT_HEARTBEAT_TIMEOUT,
            queue_capacity: DEFAULT_QUEUE_CAPACITY,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BrowserSessionErrorCode {
    Backpressure,
    HandshakeTimeout,
    HeartbeatTimeout,
    IdentityExhausted,
    InvalidMessage,
    InvalidRole,
    NegotiationFailed,
    ProtocolViolation,
    RegistryRejected,
    Transport,
}

impl BrowserSessionErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Backpressure => "browser_session_backpressure",
            Self::HandshakeTimeout => "browser_session_handshake_timeout",
            Self::HeartbeatTimeout => "browser_session_heartbeat_timeout",
            Self::IdentityExhausted => "browser_session_identity_exhausted",
            Self::InvalidMessage => "browser_session_invalid_message",
            Self::InvalidRole => "browser_session_invalid_role",
            Self::NegotiationFailed => "browser_session_negotiation_failed",
            Self::ProtocolViolation => "browser_session_protocol_violation",
            Self::RegistryRejected => "browser_session_registry_rejected",
            Self::Transport => "browser_session_transport_failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("browser session failed: {code:?}")]
pub struct BrowserSessionError {
    code: BrowserSessionErrorCode,
}

impl BrowserSessionError {
    pub const fn code(self) -> BrowserSessionErrorCode {
        self.code
    }
}

#[derive(Clone)]
pub struct BrowserSessionManager {
    registry: SharedCapabilityRegistry,
    ids: Arc<ConnectionIdAllocator>,
    config: BrowserSessionConfig,
}

impl fmt::Debug for BrowserSessionManager {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BrowserSessionManager")
            .field("config", &self.config)
            .finish_non_exhaustive()
    }
}

impl BrowserSessionManager {
    pub fn new(
        registry: SharedCapabilityRegistry,
        connection_namespace: impl Into<String>,
    ) -> Self {
        Self::with_config(
            registry,
            connection_namespace,
            BrowserSessionConfig::default(),
        )
    }

    pub fn with_config(
        registry: SharedCapabilityRegistry,
        connection_namespace: impl Into<String>,
        config: BrowserSessionConfig,
    ) -> Self {
        Self {
            registry,
            ids: Arc::new(ConnectionIdAllocator::new(connection_namespace.into())),
            config,
        }
    }

    pub fn registry(&self) -> SharedCapabilityRegistry {
        self.registry.clone()
    }

    pub async fn run<R, W>(
        &self,
        mut reader: R,
        mut writer: W,
        shutdown: CancellationToken,
    ) -> Result<(), BrowserSessionError>
    where
        R: AsyncRead + Send + Unpin + 'static,
        W: AsyncWrite + Send + Unpin + 'static,
    {
        let Some((connection_id, negotiation)) =
            self.negotiate(&mut reader, &mut writer, &shutdown).await?
        else {
            return Ok(());
        };
        let (connection, driver) = stream_browser_connection(
            connection_id.clone(),
            selected_version(&negotiation)?,
            reader,
            writer,
            negotiation,
            self.config.queue_capacity,
        );
        self.registry
            .lock()
            .await
            .add_connection(connection.clone())
            .map_err(|_| session_error(BrowserSessionErrorCode::RegistryRejected))?;

        let mut driver = Box::pin(driver.run());
        let mut completed_driver = None;
        let mut heartbeat_deadline = Instant::now() + self.config.heartbeat_timeout;
        let session_result = loop {
            tokio::select! {
                biased;
                () = shutdown.cancelled() => break Ok(()),
                result = &mut driver => {
                    completed_driver = Some(result.map_err(map_connection_error));
                    break Ok(());
                }
                message = connection.receive() => {
                    match message.map_err(map_connection_error)? {
                        Some(Message::Heartbeat(_)) => {
                            heartbeat_deadline = Instant::now() + self.config.heartbeat_timeout;
                        }
                        Some(Message::ConnectionError(message)) if message.fatal => break Ok(()),
                        Some(Message::ConnectionError(_)) => {}
                        Some(_) => break Err(session_error(
                            BrowserSessionErrorCode::ProtocolViolation,
                        )),
                        None => break Ok(()),
                    }
                }
                () = tokio::time::sleep_until(heartbeat_deadline) => {
                    break Err(session_error(BrowserSessionErrorCode::HeartbeatTimeout));
                }
            }
        };

        let _ = connection.close().await;
        self.registry.lock().await.remove_connection(&connection_id);
        let driver_result = match completed_driver {
            Some(result) => result,
            None => driver.await.map_err(map_connection_error),
        };
        session_result.and(driver_result)
    }

    async fn negotiate<R, W>(
        &self,
        reader: &mut R,
        writer: &mut W,
        shutdown: &CancellationToken,
    ) -> Result<Option<(BrowserConnectionId, AcceptorNegotiation)>, BrowserSessionError>
    where
        R: AsyncRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        let read = async {
            read_json_frame_with_partial_timeout(reader, PARTIAL_LOCAL_FRAME_TIMEOUT)
                .await
                .map_err(map_frame_error)
        };
        let payload = tokio::select! {
            biased;
            () = shutdown.cancelled() => return Ok(None),
            result = timeout(self.config.handshake_timeout, read) => {
                result.map_err(|_| session_error(BrowserSessionErrorCode::HandshakeTimeout))??
            }
        };
        let Some(payload) = payload else {
            return Ok(None);
        };
        let message = parse_message(&payload)
            .map_err(|_| session_error(BrowserSessionErrorCode::InvalidMessage))?;
        let Message::Hello(hello) = &message else {
            return Err(session_error(BrowserSessionErrorCode::ProtocolViolation));
        };
        if hello.role != Role::Extension {
            return Err(session_error(BrowserSessionErrorCode::InvalidRole));
        }

        let mut negotiation = AcceptorNegotiation::new(SUPPORTED_PROTOCOL_VERSIONS.to_vec())
            .map_err(|_| session_error(BrowserSessionErrorCode::NegotiationFailed))?;
        let NegotiationEvent::SendHelloAck {
            selected_protocol_version,
        } = negotiation
            .receive(&message)
            .map_err(|_| session_error(BrowserSessionErrorCode::NegotiationFailed))?
        else {
            return Err(session_error(BrowserSessionErrorCode::NegotiationFailed));
        };
        let connection_id = self.ids.next()?;
        let acknowledgement = Message::HelloAck(HelloAck {
            protocol_version: PROTOCOL_VERSION,
            selected_protocol_version,
            connection_id: connection_id.as_str().to_owned(),
            implementation: Implementation {
                name: "mcpatch-bridge".to_owned(),
                version: PRODUCT_VERSION.to_owned(),
            },
        });
        let payload = serde_json::to_vec(&acknowledgement)
            .map_err(|_| session_error(BrowserSessionErrorCode::InvalidMessage))?;
        write_json_frame(writer, &payload)
            .await
            .map_err(|_| session_error(BrowserSessionErrorCode::Transport))?;
        negotiation
            .acknowledgement_sent()
            .map_err(|_| session_error(BrowserSessionErrorCode::NegotiationFailed))?;
        Ok(Some((connection_id, negotiation)))
    }
}

struct ConnectionIdAllocator {
    namespace: String,
    next: AtomicU64,
}

impl ConnectionIdAllocator {
    fn new(namespace: String) -> Self {
        Self {
            namespace,
            next: AtomicU64::new(0),
        }
    }

    fn next(&self) -> Result<BrowserConnectionId, BrowserSessionError> {
        let sequence = self
            .next
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .map_err(|_| session_error(BrowserSessionErrorCode::IdentityExhausted))?;
        BrowserConnectionId::parse(format!("browser.{}.{sequence:x}", self.namespace))
            .map_err(|_| session_error(BrowserSessionErrorCode::IdentityExhausted))
    }
}

fn selected_version(negotiation: &AcceptorNegotiation) -> Result<u32, BrowserSessionError> {
    match negotiation.phase() {
        crate::protocol::NegotiationPhase::Ready { protocol_version } => Ok(protocol_version),
        _ => Err(session_error(BrowserSessionErrorCode::NegotiationFailed)),
    }
}

fn map_connection_error(error: super::BrowserConnectionError) -> BrowserSessionError {
    let code = match error.code() {
        BrowserConnectionErrorCode::Backpressure => BrowserSessionErrorCode::Backpressure,
        BrowserConnectionErrorCode::Closed => BrowserSessionErrorCode::Transport,
        BrowserConnectionErrorCode::InvalidMessage => BrowserSessionErrorCode::InvalidMessage,
        BrowserConnectionErrorCode::Transport => BrowserSessionErrorCode::Transport,
    };
    session_error(code)
}

fn map_frame_error(error: LocalFrameError) -> BrowserSessionError {
    let code = match error.code() {
        LocalFrameErrorCode::EmptyMessage
        | LocalFrameErrorCode::InvalidJson
        | LocalFrameErrorCode::MessageTooLarge
        | LocalFrameErrorCode::TruncatedHeader
        | LocalFrameErrorCode::TruncatedPayload => BrowserSessionErrorCode::InvalidMessage,
        LocalFrameErrorCode::ReadFailed | LocalFrameErrorCode::WriteFailed => {
            BrowserSessionErrorCode::Transport
        }
    };
    session_error(code)
}

const fn session_error(code: BrowserSessionErrorCode) -> BrowserSessionError {
    BrowserSessionError { code }
}
