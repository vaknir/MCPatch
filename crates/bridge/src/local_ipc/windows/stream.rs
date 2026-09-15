use std::io::{self, Read};

use interprocess::os::windows::named_pipe::{DuplexPipeStream, pipe_mode};

use super::identity::current_thread_logon_sid;
use crate::local_ipc::{
    LocalFrameError, WindowsIpcError, WindowsIpcErrorCode, read_json_frame_blocking,
    write_json_frame_blocking,
};

type BytePipeStream = DuplexPipeStream<pipe_mode::Bytes>;

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
        self.inner.read(buffer)
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
