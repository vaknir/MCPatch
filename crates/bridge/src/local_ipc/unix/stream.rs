use tokio::net::UnixStream;

use crate::local_ipc::{
    LocalFrameError, UnixIpcError, UnixIpcErrorCode, read_json_frame, write_json_frame,
};

/// Unix stream whose peer UID was checked before construction.
#[derive(Debug)]
pub struct AuthenticatedUnixStream {
    inner: UnixStream,
    peer_uid: u32,
}

impl AuthenticatedUnixStream {
    pub(crate) fn authenticate(inner: UnixStream, expected_uid: u32) -> Result<Self, UnixIpcError> {
        let peer_uid = inner
            .peer_cred()
            .map_err(|error| {
                UnixIpcError::with_source(UnixIpcErrorCode::PeerCredentialsUnavailable, error)
            })?
            .uid();
        if peer_uid != expected_uid {
            return Err(UnixIpcError::without_source(
                UnixIpcErrorCode::PeerUnauthorized,
            ));
        }
        Ok(Self { inner, peer_uid })
    }

    pub const fn peer_uid(&self) -> u32 {
        self.peer_uid
    }

    pub async fn read_json(&mut self) -> Result<Option<Vec<u8>>, LocalFrameError> {
        read_json_frame(&mut self.inner).await
    }

    pub async fn write_json(&mut self, payload: &[u8]) -> Result<(), LocalFrameError> {
        write_json_frame(&mut self.inner, payload).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_a_peer_uid_mismatch() {
        let (stream, _peer) = UnixStream::pair().unwrap();
        let actual = stream.peer_cred().unwrap().uid();
        let error = AuthenticatedUnixStream::authenticate(stream, actual.wrapping_add(1))
            .expect_err("mismatched UID must fail");
        assert_eq!(error.code(), UnixIpcErrorCode::PeerUnauthorized);
    }
}
