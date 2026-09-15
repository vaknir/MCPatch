use std::io::{self, Read, Write};

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

    let length = validate_length(header)?;
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| read_error(LocalFrameErrorCode::TruncatedPayload, error))?;
    validate_payload(&payload)?;
    Ok(Some(payload))
}

/// Validate, write, and flush one little-endian local IPC JSON frame.
pub async fn write_json_frame<W>(writer: &mut W, payload: &[u8]) -> Result<(), LocalFrameError>
where
    W: AsyncWrite + Unpin,
{
    validate_payload(payload)?;
    let length = u32::try_from(payload.len())
        .map_err(|_| LocalFrameError::without_source(LocalFrameErrorCode::MessageTooLarge))?;

    writer
        .write_all(&length.to_le_bytes())
        .await
        .map_err(write_error)?;
    writer.write_all(payload).await.map_err(write_error)?;
    writer.flush().await.map_err(write_error)
}

/// Read one little-endian, bounded, strict-JSON frame from a blocking stream.
pub fn read_json_frame_blocking<R>(reader: &mut R) -> Result<Option<Vec<u8>>, LocalFrameError>
where
    R: Read,
{
    let mut header = [0_u8; size_of::<u32>()];
    match reader.read(&mut header[..1]) {
        Ok(0) => return Ok(None),
        Ok(_) => {}
        Err(error) => return Err(read_error(LocalFrameErrorCode::ReadFailed, error)),
    }
    reader
        .read_exact(&mut header[1..])
        .map_err(|error| read_error(LocalFrameErrorCode::TruncatedHeader, error))?;

    let length = validate_length(header)?;
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| read_error(LocalFrameErrorCode::TruncatedPayload, error))?;
    validate_payload(&payload)?;
    Ok(Some(payload))
}

/// Validate, write, and flush one frame to a blocking stream.
pub fn write_json_frame_blocking<W>(writer: &mut W, payload: &[u8]) -> Result<(), LocalFrameError>
where
    W: Write,
{
    validate_payload(payload)?;
    let length = u32::try_from(payload.len())
        .map_err(|_| LocalFrameError::without_source(LocalFrameErrorCode::MessageTooLarge))?;
    writer
        .write_all(&length.to_le_bytes())
        .map_err(write_error)?;
    writer.write_all(payload).map_err(write_error)?;
    writer.flush().map_err(write_error)
}

fn validate_length(header: [u8; size_of::<u32>()]) -> Result<usize, LocalFrameError> {
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
    Ok(length)
}

fn validate_payload(payload: &[u8]) -> Result<(), LocalFrameError> {
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
    Ok(())
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

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn blocking_frames_use_the_shared_little_endian_contract() {
        let payload = br#"{"ok":true}"#;
        let mut frame = Vec::new();
        write_json_frame_blocking(&mut frame, payload).unwrap();
        assert_eq!(
            &frame[..4],
            &u32::try_from(payload.len()).unwrap().to_le_bytes()
        );

        let mut reader = Cursor::new(frame);
        assert_eq!(
            read_json_frame_blocking(&mut reader).unwrap(),
            Some(payload.to_vec())
        );
    }

    #[test]
    fn blocking_frames_reject_ambiguous_json() {
        let payload = br#"{"value":1,"value":2}"#;
        let mut frame = u32::try_from(payload.len()).unwrap().to_le_bytes().to_vec();
        frame.extend_from_slice(payload);

        let error = read_json_frame_blocking(&mut Cursor::new(frame)).unwrap_err();
        assert_eq!(error.code(), LocalFrameErrorCode::InvalidJson);
    }
}
