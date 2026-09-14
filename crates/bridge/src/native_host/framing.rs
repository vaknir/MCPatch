use std::io;

use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::protocol::{MAX_MESSAGE_BYTES, Message, parse_message};

/// MCPatch's symmetric Native Messaging frame limit.
pub const MAX_NATIVE_MESSAGE_BYTES: usize = MAX_MESSAGE_BYTES;

/// Stable Native Messaging framing failure categories.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeMessageErrorCode {
    EmptyMessage,
    InvalidProtocol,
    MessageTooLarge,
    ReadFailed,
    TruncatedHeader,
    TruncatedPayload,
    WriteFailed,
}

impl NativeMessageErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EmptyMessage => "native_message_empty",
            Self::InvalidProtocol => "native_message_invalid_protocol",
            Self::MessageTooLarge => "native_message_too_large",
            Self::ReadFailed => "native_message_read_failed",
            Self::TruncatedHeader => "native_message_truncated_header",
            Self::TruncatedPayload => "native_message_truncated_payload",
            Self::WriteFailed => "native_message_write_failed",
        }
    }
}

/// A payload-free framing error that never includes browser data.
#[derive(Debug, Error)]
#[error("Native Messaging frame failed: {code:?}")]
pub struct NativeMessageError {
    code: NativeMessageErrorCode,
    #[source]
    source: Option<io::Error>,
}

impl NativeMessageError {
    pub const fn code(&self) -> NativeMessageErrorCode {
        self.code
    }

    const fn without_source(code: NativeMessageErrorCode) -> Self {
        Self { code, source: None }
    }

    fn with_source(code: NativeMessageErrorCode, source: io::Error) -> Self {
        Self {
            code,
            source: Some(source),
        }
    }
}

/// Read and validate one complete Native Messaging protocol frame.
pub async fn read_message<R>(reader: &mut R) -> Result<Option<Message>, NativeMessageError>
where
    R: AsyncRead + Unpin,
{
    let mut header = [0_u8; size_of::<u32>()];
    match reader.read(&mut header[..1]).await {
        Ok(0) => return Ok(None),
        Ok(_) => {}
        Err(error) => {
            return Err(NativeMessageError::with_source(
                NativeMessageErrorCode::ReadFailed,
                error,
            ));
        }
    }

    reader
        .read_exact(&mut header[1..])
        .await
        .map_err(|error| map_read_error(error, NativeMessageErrorCode::TruncatedHeader))?;
    let length = usize::try_from(u32::from_ne_bytes(header))
        .map_err(|_| NativeMessageError::without_source(NativeMessageErrorCode::MessageTooLarge))?;
    if length == 0 {
        return Err(NativeMessageError::without_source(
            NativeMessageErrorCode::EmptyMessage,
        ));
    }
    if length > MAX_NATIVE_MESSAGE_BYTES {
        return Err(NativeMessageError::without_source(
            NativeMessageErrorCode::MessageTooLarge,
        ));
    }

    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| map_read_error(error, NativeMessageErrorCode::TruncatedPayload))?;
    parse_message(&payload)
        .map(Some)
        .map_err(|_| NativeMessageError::without_source(NativeMessageErrorCode::InvalidProtocol))
}

/// Validate, encode, and flush one complete Native Messaging protocol frame.
pub async fn write_message<W>(writer: &mut W, message: &Message) -> Result<(), NativeMessageError>
where
    W: AsyncWrite + Unpin,
{
    message
        .validate()
        .map_err(|_| NativeMessageError::without_source(NativeMessageErrorCode::InvalidProtocol))?;
    let payload = serde_json::to_vec(message)
        .map_err(|_| NativeMessageError::without_source(NativeMessageErrorCode::InvalidProtocol))?;
    if payload.len() > MAX_NATIVE_MESSAGE_BYTES {
        return Err(NativeMessageError::without_source(
            NativeMessageErrorCode::MessageTooLarge,
        ));
    }
    let length = u32::try_from(payload.len())
        .map_err(|_| NativeMessageError::without_source(NativeMessageErrorCode::MessageTooLarge))?;

    writer
        .write_all(&length.to_ne_bytes())
        .await
        .map_err(|error| {
            NativeMessageError::with_source(NativeMessageErrorCode::WriteFailed, error)
        })?;
    writer.write_all(&payload).await.map_err(|error| {
        NativeMessageError::with_source(NativeMessageErrorCode::WriteFailed, error)
    })?;
    writer.flush().await.map_err(|error| {
        NativeMessageError::with_source(NativeMessageErrorCode::WriteFailed, error)
    })
}

fn map_read_error(error: io::Error, truncated: NativeMessageErrorCode) -> NativeMessageError {
    let code = if error.kind() == io::ErrorKind::UnexpectedEof {
        truncated
    } else {
        NativeMessageErrorCode::ReadFailed
    };
    NativeMessageError::with_source(code, error)
}
