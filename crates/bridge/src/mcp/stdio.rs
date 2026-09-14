use std::{io, sync::Arc};

use futures_util::StreamExt;
use rmcp::{
    RoleServer,
    service::{RxJsonRpcMessage, TxJsonRpcMessage},
    transport::{
        Transport,
        async_rw::{JsonRpcMessageCodec, JsonRpcMessageCodecError},
    },
};
use serde::Serialize;
use tokio::{
    io::{AsyncRead, AsyncWrite, AsyncWriteExt},
    sync::Mutex,
};
use tokio_util::codec::FramedRead;

/// Maximum encoded JSON-RPC line accepted or emitted by the MCP stdio adapter.
pub const MAX_MCP_MESSAGE_BYTES: usize = 1024 * 1024;

pub struct BoundedStdioTransport<R, W> {
    read: FramedRead<R, JsonRpcMessageCodec<RxJsonRpcMessage<RoleServer>>>,
    write: Arc<Mutex<Option<W>>>,
}

pub fn bounded_stdio() -> BoundedStdioTransport<tokio::io::Stdin, tokio::io::Stdout> {
    BoundedStdioTransport::new(tokio::io::stdin(), tokio::io::stdout())
}

impl<R, W> BoundedStdioTransport<R, W>
where
    R: AsyncRead,
{
    pub fn new(read: R, write: W) -> Self {
        Self {
            read: FramedRead::new(
                read,
                JsonRpcMessageCodec::new_with_max_length(MAX_MCP_MESSAGE_BYTES),
            ),
            write: Arc::new(Mutex::new(Some(write))),
        }
    }
}

impl<R, W> Transport<RoleServer> for BoundedStdioTransport<R, W>
where
    R: AsyncRead + Send + Unpin,
    W: AsyncWrite + Send + Unpin + 'static,
{
    type Error = io::Error;

    fn send(
        &mut self,
        item: TxJsonRpcMessage<RoleServer>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send + 'static {
        let write = self.write.clone();
        async move {
            let frame = encode_frame(&item)?;
            let mut guard = write.lock().await;
            let writer = guard
                .as_mut()
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "transport closed"))?;
            writer.write_all(&frame).await?;
            writer.flush().await
        }
    }

    async fn receive(&mut self) -> Option<RxJsonRpcMessage<RoleServer>> {
        match self.read.next().await {
            Some(Ok(message)) => Some(message),
            Some(Err(error)) => {
                let reason = if matches!(error, JsonRpcMessageCodecError::MaxLineLengthExceeded) {
                    "message_too_large"
                } else {
                    "invalid_message"
                };
                tracing::warn!(target: "mcpatch", event = "mcp_input_rejected", reason);
                None
            }
            None => None,
        }
    }

    async fn close(&mut self) -> Result<(), Self::Error> {
        let mut guard = self.write.lock().await;
        if let Some(mut writer) = guard.take() {
            writer.shutdown().await?;
        }
        Ok(())
    }
}

fn encode_frame(value: &impl Serialize) -> Result<Vec<u8>, io::Error> {
    let mut frame = serde_json::to_vec(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if frame.len() > MAX_MCP_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "MCP message exceeds maximum size",
        ));
    }
    frame.push(b'\n');
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{MAX_MCP_MESSAGE_BYTES, encode_frame};

    #[test]
    fn outbound_frames_are_newline_delimited() {
        let frame = encode_frame(&json!({"jsonrpc": "2.0"})).expect("small frame must encode");
        assert_eq!(frame.last(), Some(&b'\n'));
    }

    #[test]
    fn oversized_outbound_frames_are_rejected() {
        let value = "x".repeat(MAX_MCP_MESSAGE_BYTES + 1);
        let error = encode_frame(&value).expect_err("oversized frame must fail");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }
}
