use std::io;

use crate::{
    local_ipc::{
        AuthenticatedWindowsStream, LocalFrameError, LocalFrameErrorCode, MAX_LOCAL_IPC_FRAME_BYTES,
    },
    protocol::parse_strict_json_value,
};

pub(super) enum FramePoll {
    Closed,
    Complete,
    Pending,
}

pub(super) struct NonblockingFrameReader {
    header: [u8; size_of::<u32>()],
    header_read: usize,
    payload: Vec<u8>,
    payload_read: usize,
}

impl NonblockingFrameReader {
    pub(super) const fn new() -> Self {
        Self {
            header: [0; size_of::<u32>()],
            header_read: 0,
            payload: Vec::new(),
            payload_read: 0,
        }
    }

    pub(super) fn poll(
        &mut self,
        stream: &mut AuthenticatedWindowsStream,
    ) -> Result<FramePoll, LocalFrameError> {
        loop {
            if self.header_read < self.header.len() {
                match stream.read_some(&mut self.header[self.header_read..]) {
                    Ok(0) if self.header_read == 0 => return Ok(FramePoll::Closed),
                    Ok(0) => return Err(truncated(LocalFrameErrorCode::TruncatedHeader)),
                    Ok(read) => self.header_read += read,
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        return Ok(FramePoll::Pending);
                    }
                    Err(error) => return Err(read_failed(error)),
                }
                if self.header_read < self.header.len() {
                    continue;
                }

                let length = usize::try_from(u32::from_le_bytes(self.header)).map_err(|_| {
                    LocalFrameError::without_source(LocalFrameErrorCode::MessageTooLarge)
                })?;
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
                self.payload.resize(length, 0);
            }

            match stream.read_some(&mut self.payload[self.payload_read..]) {
                Ok(0) => return Err(truncated(LocalFrameErrorCode::TruncatedPayload)),
                Ok(read) => self.payload_read += read,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    return Ok(FramePoll::Pending);
                }
                Err(error) => return Err(read_failed(error)),
            }
            if self.payload_read < self.payload.len() {
                continue;
            }

            parse_strict_json_value(&self.payload)
                .map_err(|_| LocalFrameError::without_source(LocalFrameErrorCode::InvalidJson))?;
            self.header_read = 0;
            self.payload.clear();
            self.payload_read = 0;
            return Ok(FramePoll::Complete);
        }
    }

    pub(super) const fn has_partial_frame(&self) -> bool {
        self.header_read != 0
    }
}

fn truncated(code: LocalFrameErrorCode) -> LocalFrameError {
    LocalFrameError::without_source(code)
}

fn read_failed(error: io::Error) -> LocalFrameError {
    LocalFrameError::with_source(LocalFrameErrorCode::ReadFailed, error)
}
