use std::{io, sync::Arc, time::Duration};

use rmcp::{
    RoleServer, ServiceExt,
    service::{RxJsonRpcMessage, ServerInitializeError, TxJsonRpcMessage},
    transport::Transport,
};
use thiserror::Error;
use tokio::{
    io::{AsyncRead, AsyncWrite, AsyncWriteExt},
    sync::Mutex,
    task::JoinError,
};
use tokio_util::sync::CancellationToken;

use super::BridgeMcpServer;
use crate::local_ipc::{
    LocalFrameError, LocalFrameErrorCode, read_json_frame_with_partial_timeout, write_json_frame,
};

pub(crate) const PARTIAL_LOCAL_FRAME_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Error)]
pub(crate) enum CoreMcpSessionError {
    #[error("MCP session initialization failed")]
    Initialization(#[source] Box<ServerInitializeError>),
    #[error("MCP session service task failed")]
    ServiceTask(#[source] JoinError),
}

impl CoreMcpSessionError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::Initialization(_) => "core_mcp_initialization_failed",
            Self::ServiceTask(_) => "core_mcp_service_task_failed",
        }
    }
}

/// Run one MCP server session over an already authenticated core-side stream.
pub(crate) async fn run_core_mcp_session<R, W>(
    server: BridgeMcpServer,
    reader: R,
    writer: W,
    cancellation: CancellationToken,
) -> Result<(), CoreMcpSessionError>
where
    R: AsyncRead + Send + Unpin + 'static,
    W: AsyncWrite + Send + Unpin + 'static,
{
    let transport = CoreMcpTransport::new(reader, writer);
    let running = match server.serve_with_ct(transport, cancellation).await {
        Ok(running) => running,
        Err(ServerInitializeError::Cancelled | ServerInitializeError::ConnectionClosed(_)) => {
            return Ok(());
        }
        Err(error) => return Err(CoreMcpSessionError::Initialization(Box::new(error))),
    };

    running
        .waiting()
        .await
        .map(|_| ())
        .map_err(CoreMcpSessionError::ServiceTask)
}

struct CoreMcpTransport<R, W> {
    reader: R,
    writer: Arc<Mutex<Option<W>>>,
}

impl<R, W> CoreMcpTransport<R, W> {
    fn new(reader: R, writer: W) -> Self {
        Self {
            reader,
            writer: Arc::new(Mutex::new(Some(writer))),
        }
    }
}

impl<R, W> Transport<RoleServer> for CoreMcpTransport<R, W>
where
    R: AsyncRead + Send + Unpin,
    W: AsyncWrite + Send + Unpin + 'static,
{
    type Error = CoreMcpTransportError;

    fn send(
        &mut self,
        item: TxJsonRpcMessage<RoleServer>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send + 'static {
        let writer = Arc::clone(&self.writer);
        async move {
            let payload = serde_json::to_vec(&item).map_err(CoreMcpTransportError::Encode)?;
            let mut guard = writer.lock().await;
            let writer = guard.as_mut().ok_or(CoreMcpTransportError::Closed)?;
            write_json_frame(writer, &payload)
                .await
                .map_err(CoreMcpTransportError::Frame)
        }
    }

    async fn receive(&mut self) -> Option<RxJsonRpcMessage<RoleServer>> {
        let payload = match read_json_frame_with_partial_timeout(
            &mut self.reader,
            PARTIAL_LOCAL_FRAME_TIMEOUT,
        )
        .await
        {
            Ok(Some(payload)) => payload,
            Ok(None) => return None,
            Err(error) => {
                tracing::warn!(
                    target: "mcpatch",
                    event = "core_mcp_input_rejected",
                    reason = local_frame_reason(error.code())
                );
                return None;
            }
        };

        match serde_json::from_slice(&payload) {
            Ok(message) => Some(message),
            Err(_) => {
                tracing::warn!(
                    target: "mcpatch",
                    event = "core_mcp_input_rejected",
                    reason = "invalid_message"
                );
                None
            }
        }
    }

    async fn close(&mut self) -> Result<(), Self::Error> {
        let mut guard = self.writer.lock().await;
        if let Some(mut writer) = guard.take() {
            writer
                .shutdown()
                .await
                .map_err(CoreMcpTransportError::Shutdown)?;
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
enum CoreMcpTransportError {
    #[error("MCP transport is closed")]
    Closed,
    #[error("MCP response encoding failed")]
    Encode(#[source] serde_json::Error),
    #[error("local MCP frame failed")]
    Frame(#[source] LocalFrameError),
    #[error("local MCP stream shutdown failed")]
    Shutdown(#[source] io::Error),
}

const fn local_frame_reason(code: LocalFrameErrorCode) -> &'static str {
    match code {
        LocalFrameErrorCode::EmptyMessage
        | LocalFrameErrorCode::InvalidJson
        | LocalFrameErrorCode::MessageTooLarge
        | LocalFrameErrorCode::TruncatedHeader
        | LocalFrameErrorCode::TruncatedPayload => "invalid_frame",
        LocalFrameErrorCode::ReadFailed | LocalFrameErrorCode::WriteFailed => "transport_failed",
    }
}
