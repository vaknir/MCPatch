use std::{
    fs, io,
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    time::Duration,
};

use tokio::net::{UnixListener, UnixStream};
use tokio::time::timeout;

use super::{AuthenticatedUnixStream, UnixCoreElection, UnixRuntime};
use crate::local_ipc::{EndpointRole, UnixIpcError, UnixIpcErrorCode};

const PRIVATE_SOCKET_MODE: u32 = 0o600;
const ENDPOINT_PROBE_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct EndpointIdentity {
    device: u64,
    inode: u64,
}

/// Bound endpoint that removes only the socket node it created.
#[derive(Debug)]
pub struct UnixEndpointListener {
    listener: UnixListener,
    path: PathBuf,
    identity: EndpointIdentity,
    expected_uid: u32,
}

impl UnixRuntime {
    /// Bind under the exact channel election, replacing only an owned stale socket.
    pub async fn bind_after_election(
        &self,
        election: &UnixCoreElection,
        role: EndpointRole,
    ) -> Result<UnixEndpointListener, UnixIpcError> {
        self.verify()?;
        election.authorizes(self)?;
        let path = self.socket_path(role);
        prepare_socket_path(&path, self.expected_uid()).await?;

        let listener = UnixListener::bind(&path).map_err(|error| {
            let code = if error.kind() == io::ErrorKind::AddrInUse {
                UnixIpcErrorCode::EndpointInUse
            } else {
                UnixIpcErrorCode::Io
            };
            UnixIpcError::with_source(code, error)
        })?;
        let bound_identity = raw_socket_identity(&path, self.expected_uid())?
            .ok_or_else(|| UnixIpcError::without_source(UnixIpcErrorCode::UnsafeEndpoint))?;
        if let Err(error) =
            fs::set_permissions(&path, fs::Permissions::from_mode(PRIVATE_SOCKET_MODE))
        {
            remove_if_same_socket(&path, self.expected_uid(), bound_identity);
            return Err(UnixIpcError::with_source(UnixIpcErrorCode::Io, error));
        }
        let identity = match endpoint_identity(&path, self.expected_uid())? {
            Some(identity) if identity == bound_identity => identity,
            _ => {
                remove_if_same_socket(&path, self.expected_uid(), bound_identity);
                return Err(UnixIpcError::without_source(
                    UnixIpcErrorCode::UnsafeEndpoint,
                ));
            }
        };

        Ok(UnixEndpointListener {
            listener,
            path,
            identity,
            expected_uid: self.expected_uid(),
        })
    }

    /// Connect to a fixed role endpoint and authenticate the server UID.
    pub async fn connect(
        &self,
        role: EndpointRole,
    ) -> Result<AuthenticatedUnixStream, UnixIpcError> {
        self.verify()?;
        let path = self.socket_path(role);
        endpoint_identity(&path, self.expected_uid())?
            .ok_or_else(|| UnixIpcError::without_source(UnixIpcErrorCode::EndpointUnavailable))?;
        let stream = UnixStream::connect(path).await.map_err(|error| {
            UnixIpcError::with_source(UnixIpcErrorCode::EndpointUnavailable, error)
        })?;
        AuthenticatedUnixStream::authenticate(stream, self.expected_uid())
    }
}

impl UnixEndpointListener {
    /// Accept a stream and authenticate its peer UID before returning it.
    pub async fn accept_authenticated(&self) -> Result<AuthenticatedUnixStream, UnixIpcError> {
        let (stream, _) = self
            .listener
            .accept()
            .await
            .map_err(|error| UnixIpcError::with_source(UnixIpcErrorCode::Io, error))?;
        AuthenticatedUnixStream::authenticate(stream, self.expected_uid)
    }
}

impl Drop for UnixEndpointListener {
    fn drop(&mut self) {
        remove_if_same_socket(&self.path, self.expected_uid, self.identity);
    }
}

async fn prepare_socket_path(path: &Path, expected_uid: u32) -> Result<(), UnixIpcError> {
    let Some(before) = endpoint_identity(path, expected_uid)? else {
        return Ok(());
    };

    if !matches!(
        timeout(ENDPOINT_PROBE_TIMEOUT, UnixStream::connect(path)).await,
        Ok(Err(_))
    ) {
        return Err(UnixIpcError::without_source(
            UnixIpcErrorCode::EndpointInUse,
        ));
    }

    if endpoint_identity(path, expected_uid)? != Some(before) {
        return Err(UnixIpcError::without_source(
            UnixIpcErrorCode::UnsafeEndpoint,
        ));
    }
    fs::remove_file(path).map_err(|error| UnixIpcError::with_source(UnixIpcErrorCode::Io, error))
}

fn endpoint_identity(
    path: &Path,
    expected_uid: u32,
) -> Result<Option<EndpointIdentity>, UnixIpcError> {
    let Some(identity) = raw_socket_identity(path, expected_uid)? else {
        return Ok(None);
    };
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| UnixIpcError::with_source(UnixIpcErrorCode::Io, error))?;
    if metadata.mode() & 0o777 != PRIVATE_SOCKET_MODE
        || metadata.dev() != identity.device
        || metadata.ino() != identity.inode
    {
        return Err(UnixIpcError::without_source(
            UnixIpcErrorCode::UnsafeEndpoint,
        ));
    }
    Ok(Some(identity))
}

fn raw_socket_identity(
    path: &Path,
    expected_uid: u32,
) -> Result<Option<EndpointIdentity>, UnixIpcError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(UnixIpcError::with_source(UnixIpcErrorCode::Io, error)),
    };
    if !metadata.file_type().is_socket() || metadata.uid() != expected_uid {
        return Err(UnixIpcError::without_source(
            UnixIpcErrorCode::UnsafeEndpoint,
        ));
    }
    Ok(Some(EndpointIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }))
}

fn remove_if_same_socket(path: &Path, expected_uid: u32, expected: EndpointIdentity) {
    if raw_socket_identity(path, expected_uid).ok().flatten() == Some(expected) {
        let _ = fs::remove_file(path);
    }
}
