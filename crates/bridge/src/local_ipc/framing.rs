use std::io;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::{LocalFrameError, LocalFrameErrorCode};
use crate::protocol::{MAX_MESSAGE_BYTES, parse_strict_json_value};

/// Maximum JSON payload accepted on either local IPC endpoint.
pub const MAX_LOCAL_IPC_FRAME_BYTES: usize = MAX_MESSAGE_BYTES;

/// Read one little-endian, bounded, strict-JSON local IPC frame.
pub async fn read_json_frame<R>(reader: &mut R) -> Result<Option<Vec<u8>>, LocalFrameError>
where
    R: AsyncRead + Unpin,
{
    let mut header = [0_u8; size_of::<u32>()];
    match reader.read(&mut header[..1]).await {
        Ok(0) => return Ok(None),
        Ok(_) => {}
        Err(error) => return Err(read_error(LocalFrameErrorCode::ReadFailed, error)),
    }
    reader
        .read_exact(&mut header[1..])
        .await
        .map_err(|error| read_error(LocalFrameErrorCode::TruncatedHeader, error))?;

    let length = usize::try_from(u32::from_le_bytes(header))
        .map_err(|_| LocalFrameError::without_source(LocalFrameErrorCode::MessageTooLarge))?;
    if length == 0 {
        return Err(LocalFrameError::without_source(
            LocalFrameErrorCode::EmptyMessage,
        ));
    }
    if length > MAX_LOCAL_IPC_FRAME_BYTES {
        return Err(LocalFrameError::without_source(
            LocalFrameErrorCode::MessageTooLarge,
        ));
    }

    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| read_error(LocalFrameErrorCode::TruncatedPayload, error))?;
    parse_strict_json_value(&payload)
        .map_err(|_| LocalFrameError::without_source(LocalFrameErrorCode::InvalidJson))?;
    Ok(Some(payload))
}

/// Validate, write, and flush one little-endian local IPC JSON frame.
pub async fn write_json_frame<W>(writer: &mut W, payload: &[u8]) -> Result<(), LocalFrameError>
where
    W: AsyncWrite + Unpin,
{
    if payload.is_empty() {
        return Err(LocalFrameError::without_source(
            LocalFrameErrorCode::EmptyMessage,
        ));
    }
    if payload.len() > MAX_LOCAL_IPC_FRAME_BYTES {
        return Err(LocalFrameError::without_source(
            LocalFrameErrorCode::MessageTooLarge,
        ));
    }
    parse_strict_json_value(payload)
        .map_err(|_| LocalFrameError::without_source(LocalFrameErrorCode::InvalidJson))?;
    let length = u32::try_from(payload.len())
        .map_err(|_| LocalFrameError::without_source(LocalFrameErrorCode::MessageTooLarge))?;

    writer
        .write_all(&length.to_le_bytes())
        .await
        .map_err(write_error)?;
    writer.write_all(payload).await.map_err(write_error)?;
    writer.flush().await.map_err(write_error)
}

fn read_error(truncated: LocalFrameErrorCode, error: io::Error) -> LocalFrameError {
    let code = if error.kind() == io::ErrorKind::UnexpectedEof {
        truncated
    } else {
        LocalFrameErrorCode::ReadFailed
    };
    LocalFrameError::with_source(code, error)
}

fn write_error(error: io::Error) -> LocalFrameError {
    LocalFrameError::with_source(LocalFrameErrorCode::WriteFailed, error)
}
