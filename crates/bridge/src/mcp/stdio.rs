use std::io;

use futures_util::StreamExt;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio_util::codec::{FramedRead, LinesCodec, LinesCodecError};

use crate::protocol::parse_strict_json_value;

/// Maximum encoded JSON-RPC line accepted or emitted by the MCP stdio adapter.
pub const MAX_MCP_MESSAGE_BYTES: usize = 1024 * 1024;

/// A bounded newline-delimited input that performs syntax, not MCP session, validation.
pub struct BoundedMcpInput<R> {
    read: FramedRead<R, LinesCodec>,
}

impl<R> BoundedMcpInput<R>
where
    R: AsyncRead,
{
    pub fn new(read: R) -> Self {
        Self {
            read: FramedRead::new(read, LinesCodec::new_with_max_length(MAX_MCP_MESSAGE_BYTES)),
        }
    }
}

impl<R> BoundedMcpInput<R>
where
    R: AsyncRead + Unpin,
{
    pub async fn receive_json(&mut self) -> Result<Option<Vec<u8>>, McpStdioFrameError> {
        let Some(line) = self.read.next().await else {
            return Ok(None);
        };
        let line = line.map_err(McpStdioFrameError::from)?;
        let payload = line.into_bytes();
        validate_payload(&payload)?;
        Ok(Some(payload))
    }
}

/// Validate and emit one newline-delimited JSON-RPC payload.
pub async fn write_json_line<W>(writer: &mut W, payload: &[u8]) -> Result<(), McpStdioFrameError>
where
    W: AsyncWrite + Unpin,
{
    validate_payload(payload)?;
    writer
        .write_all(payload)
        .await
        .map_err(McpStdioFrameError::write)?;
    writer
        .write_all(b"\n")
        .await
        .map_err(McpStdioFrameError::write)?;
    writer.flush().await.map_err(McpStdioFrameError::write)
}

#[derive(Debug, Error)]
#[error("MCP stdio framing failed: {code:?}")]
pub struct McpStdioFrameError {
    code: McpStdioFrameErrorCode,
    #[source]
    source: Option<io::Error>,
}

impl McpStdioFrameError {
    pub const fn code(&self) -> McpStdioFrameErrorCode {
        self.code
    }

    fn invalid() -> Self {
        Self {
            code: McpStdioFrameErrorCode::InvalidMessage,
            source: None,
        }
    }

    fn too_large() -> Self {
        Self {
            code: McpStdioFrameErrorCode::MessageTooLarge,
            source: None,
        }
    }

    fn write(source: io::Error) -> Self {
        Self {
            code: McpStdioFrameErrorCode::WriteFailed,
            source: Some(source),
        }
    }
}

impl From<LinesCodecError> for McpStdioFrameError {
    fn from(error: LinesCodecError) -> Self {
        match error {
            LinesCodecError::MaxLineLengthExceeded => Self::too_large(),
            LinesCodecError::Io(source) => Self {
                code: McpStdioFrameErrorCode::ReadFailed,
                source: Some(source),
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum McpStdioFrameErrorCode {
    InvalidMessage,
    MessageTooLarge,
    ReadFailed,
    WriteFailed,
}

impl McpStdioFrameErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidMessage => "mcp_stdio_invalid_message",
            Self::MessageTooLarge => "mcp_stdio_message_too_large",
            Self::ReadFailed => "mcp_stdio_read_failed",
            Self::WriteFailed => "mcp_stdio_write_failed",
        }
    }
}

fn validate_payload(payload: &[u8]) -> Result<(), McpStdioFrameError> {
    if payload.is_empty() {
        return Err(McpStdioFrameError::invalid());
    }
    if payload.len() > MAX_MCP_MESSAGE_BYTES {
        return Err(McpStdioFrameError::too_large());
    }
    parse_strict_json_value(payload)
        .map(|_| ())
        .map_err(|_| McpStdioFrameError::invalid())
}

#[cfg(test)]
mod tests {
    use tokio::io::AsyncReadExt;

    use super::*;

    #[tokio::test]
    async fn outbound_frames_are_newline_delimited() {
        let (mut writer, mut reader) = tokio::io::duplex(128);
        write_json_line(&mut writer, br#"{"jsonrpc":"2.0"}"#)
            .await
            .unwrap();
        let mut frame = vec![0_u8; 18];
        reader.read_exact(&mut frame).await.unwrap();
        assert_eq!(frame, b"{\"jsonrpc\":\"2.0\"}\n");
    }

    #[tokio::test]
    async fn oversized_input_is_rejected_before_unbounded_buffering() {
        let (mut writer, reader) = tokio::io::duplex(MAX_MCP_MESSAGE_BYTES + 16);
        let task = tokio::spawn(async move {
            let mut input = BoundedMcpInput::new(reader);
            input.receive_json().await
        });
        writer
            .write_all(&vec![b'x'; MAX_MCP_MESSAGE_BYTES + 1])
            .await
            .unwrap();
        let error = task.await.unwrap().unwrap_err();
        assert_eq!(error.code(), McpStdioFrameErrorCode::MessageTooLarge);
    }

    #[tokio::test]
    async fn duplicate_fields_are_rejected() {
        let (mut writer, reader) = tokio::io::duplex(128);
        writer.write_all(b"{\"id\":1,\"id\":2}\n").await.unwrap();
        let error = BoundedMcpInput::new(reader)
            .receive_json()
            .await
            .unwrap_err();
        assert_eq!(error.code(), McpStdioFrameErrorCode::InvalidMessage);
    }
}
