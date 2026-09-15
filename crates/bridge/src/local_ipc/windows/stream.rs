use std::{
    io::{self, Read},
    os::windows::io::AsHandle,
};

use interprocess::os::windows::named_pipe::{DuplexPipeStream, pipe_mode};
use tokio::net::windows::named_pipe::NamedPipeClient;

use super::identity::{current_thread_logon_sid, named_pipe_server_logon_sid};
use crate::local_ipc::{
    LocalFrameError, WindowsIpcError, WindowsIpcErrorCode, read_json_frame,
    read_json_frame_blocking, write_json_frame, write_json_frame_blocking,
};

type BytePipeStream = DuplexPipeStream<pipe_mode::Bytes>;

/// Async named-pipe client whose server logon SID was checked before use.
#[derive(Debug)]
pub struct AuthenticatedWindowsClientStream {
    inner: NamedPipeClient,
}

impl AuthenticatedWindowsClientStream {
    pub(super) fn authenticate(
        inner: NamedPipeClient,
        expected_logon_sid: &str,
    ) -> Result<Self, WindowsIpcError> {
        let observed = named_pipe_server_logon_sid(inner.as_handle())?;
        authorize_logon_sid(expected_logon_sid, &observed)?;
        Ok(Self { inner })
    }

    pub async fn read_json(&mut self) -> Result<Option<Vec<u8>>, LocalFrameError> {
        read_json_frame(&mut self.inner).await
    }

    pub async fn write_json(&mut self, payload: &[u8]) -> Result<(), LocalFrameError> {
        write_json_frame(&mut self.inner, payload).await
    }
}

/// Blocking named-pipe stream whose client logon SID was checked.
#[derive(Debug)]
pub struct AuthenticatedWindowsStream {
    inner: BytePipeStream,
}

impl AuthenticatedWindowsStream {
    pub(super) fn authenticate(
        inner: BytePipeStream,
        expected_logon_sid: &str,
    ) -> Result<Self, WindowsIpcError> {
        let impersonation = inner.impersonate_client().map_err(|error| {
            WindowsIpcError::with_source(WindowsIpcErrorCode::IdentityUnavailable, error)
        })?;
        let observed = current_thread_logon_sid();
        let reverted = firehazard::revert_to_self();
        drop(impersonation);

        if reverted.is_err() {
            return Err(WindowsIpcError::without_source(
                WindowsIpcErrorCode::RevertFailed,
            ));
        }
        let observed = observed?;
        authorize_logon_sid(expected_logon_sid, &observed)?;
        Ok(Self { inner })
    }

    pub fn read_json(&mut self) -> Result<Option<Vec<u8>>, LocalFrameError> {
        read_json_frame_blocking(&mut self.inner)
    }

    pub fn write_json(&mut self, payload: &[u8]) -> Result<(), LocalFrameError> {
        write_json_frame_blocking(&mut self.inner, payload)
    }

    pub(crate) fn read_some(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let available = mcpatch_windows_kernel::named_pipe_available(self.inner.as_handle())?;
        if available == 0 {
            return Err(io::Error::from(io::ErrorKind::WouldBlock));
        }

        let available = usize::try_from(available).unwrap_or(usize::MAX);
        let read_length = buffer.len().min(available);
        self.inner.read(&mut buffer[..read_length])
    }
}

fn authorize_logon_sid(expected: &str, observed: &str) -> Result<(), WindowsIpcError> {
    if expected == observed {
        Ok(())
    } else {
        Err(WindowsIpcError::without_source(
            WindowsIpcErrorCode::PeerUnauthorized,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_different_logon_sid() {
        let error = authorize_logon_sid("S-1-5-5-1-1", "S-1-5-5-1-2").unwrap_err();
        assert_eq!(error.code(), WindowsIpcErrorCode::PeerUnauthorized);
    }
}
