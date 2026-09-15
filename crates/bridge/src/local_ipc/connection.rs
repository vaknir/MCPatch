use thiserror::Error;

use super::{EndpointRole, InstallChannel, LocalFrameError, LocalFrameErrorCode};

#[cfg(unix)]
use super::{AuthenticatedUnixStream, UnixIpcError, UnixIpcErrorCode, UnixRuntime};
#[cfg(windows)]
use super::{
    AuthenticatedWindowsClientStream, WindowsIpcError, WindowsIpcErrorCode, WindowsRuntime,
};

/// Stable adapter-facing failure categories for local core connections.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalCoreConnectionErrorCode {
    MalformedFrame,
    Transport,
    Unauthorized,
    Unavailable,
    UnsafeRuntime,
}

impl LocalCoreConnectionErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MalformedFrame => "local_core_malformed_frame",
            Self::Transport => "local_core_transport_failed",
            Self::Unauthorized => "local_core_unauthorized",
            Self::Unavailable => "local_core_unavailable",
            Self::UnsafeRuntime => "local_core_runtime_unsafe",
        }
    }
}

/// Payload-free failure at the authenticated adapter-to-core boundary.
#[derive(Debug, Error)]
pub enum LocalCoreConnectionError {
    #[error("local core frame failed")]
    Frame(#[source] LocalFrameError),
    #[cfg(unix)]
    #[error("local core transport failed")]
    Unix(#[source] UnixIpcError),
    #[cfg(windows)]
    #[error("local core transport failed")]
    Windows(#[source] WindowsIpcError),
}

impl LocalCoreConnectionError {
    pub const fn code(&self) -> LocalCoreConnectionErrorCode {
        match self {
            Self::Frame(error) => match error.code() {
                LocalFrameErrorCode::EmptyMessage
                | LocalFrameErrorCode::InvalidJson
                | LocalFrameErrorCode::MessageTooLarge
                | LocalFrameErrorCode::TruncatedHeader
                | LocalFrameErrorCode::TruncatedPayload => {
                    LocalCoreConnectionErrorCode::MalformedFrame
                }
                LocalFrameErrorCode::ReadFailed | LocalFrameErrorCode::WriteFailed => {
                    LocalCoreConnectionErrorCode::Transport
                }
            },
            #[cfg(unix)]
            Self::Unix(error) => match error.code() {
                UnixIpcErrorCode::EndpointUnavailable | UnixIpcErrorCode::RuntimeUnavailable => {
                    LocalCoreConnectionErrorCode::Unavailable
                }
                UnixIpcErrorCode::PeerCredentialsUnavailable
                | UnixIpcErrorCode::PeerUnauthorized => LocalCoreConnectionErrorCode::Unauthorized,
                UnixIpcErrorCode::UnsafeEndpoint
                | UnixIpcErrorCode::UnsafeLock
                | UnixIpcErrorCode::UnsafeRuntimeDirectory => {
                    LocalCoreConnectionErrorCode::UnsafeRuntime
                }
                UnixIpcErrorCode::CoreAlreadyRunning
                | UnixIpcErrorCode::EndpointInUse
                | UnixIpcErrorCode::Io => LocalCoreConnectionErrorCode::Transport,
            },
            #[cfg(windows)]
            Self::Windows(error) => match error.code() {
                WindowsIpcErrorCode::EndpointUnavailable => {
                    LocalCoreConnectionErrorCode::Unavailable
                }
                WindowsIpcErrorCode::IdentityUnavailable
                | WindowsIpcErrorCode::PeerUnauthorized
                | WindowsIpcErrorCode::RevertFailed => LocalCoreConnectionErrorCode::Unauthorized,
                WindowsIpcErrorCode::CoreAlreadyRunning
                | WindowsIpcErrorCode::EndpointInUse
                | WindowsIpcErrorCode::Io
                | WindowsIpcErrorCode::MutexUnavailable
                | WindowsIpcErrorCode::SecurityDescriptorUnavailable
                | WindowsIpcErrorCode::WorkerFailed => LocalCoreConnectionErrorCode::Transport,
            },
        }
    }
}

impl From<LocalFrameError> for LocalCoreConnectionError {
    fn from(error: LocalFrameError) -> Self {
        Self::Frame(error)
    }
}

#[cfg(unix)]
impl From<UnixIpcError> for LocalCoreConnectionError {
    fn from(error: UnixIpcError) -> Self {
        Self::Unix(error)
    }
}

#[cfg(windows)]
impl From<WindowsIpcError> for LocalCoreConnectionError {
    fn from(error: WindowsIpcError) -> Self {
        Self::Windows(error)
    }
}

/// Prepared per-user local runtime used by short-lived adapters.
#[derive(Clone, Debug)]
pub struct LocalRuntime {
    #[cfg(unix)]
    inner: UnixRuntime,
    #[cfg(windows)]
    inner: WindowsRuntime,
}

impl LocalRuntime {
    pub async fn prepare(channel: InstallChannel) -> Result<Self, LocalCoreConnectionError> {
        #[cfg(unix)]
        {
            UnixRuntime::prepare(channel)
                .await
                .map(Self::from)
                .map_err(Into::into)
        }
        #[cfg(windows)]
        {
            WindowsRuntime::current(channel)
                .map(Self::from)
                .map_err(Into::into)
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = channel;
            Err(LocalCoreConnectionError::Frame(
                LocalFrameError::without_source(LocalFrameErrorCode::ReadFailed),
            ))
        }
    }

    /// Connect to the fixed endpoint whose path selects the parser role.
    pub async fn connect(
        &self,
        role: EndpointRole,
    ) -> Result<LocalCoreConnection, LocalCoreConnectionError> {
        #[cfg(unix)]
        {
            self.inner
                .connect(role)
                .await
                .map(LocalCoreConnection::from)
                .map_err(Into::into)
        }
        #[cfg(windows)]
        {
            self.inner
                .connect(role)
                .await
                .map(LocalCoreConnection::from)
                .map_err(Into::into)
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = role;
            Err(LocalCoreConnectionError::Frame(
                LocalFrameError::without_source(LocalFrameErrorCode::ReadFailed),
            ))
        }
    }
}

#[cfg(unix)]
impl From<UnixRuntime> for LocalRuntime {
    fn from(inner: UnixRuntime) -> Self {
        Self { inner }
    }
}

#[cfg(windows)]
impl From<WindowsRuntime> for LocalRuntime {
    fn from(inner: WindowsRuntime) -> Self {
        Self { inner }
    }
}

/// Authenticated, role-bound local connection used by an adapter.
#[derive(Debug)]
pub struct LocalCoreConnection {
    #[cfg(unix)]
    inner: AuthenticatedUnixStream,
    #[cfg(windows)]
    inner: AuthenticatedWindowsClientStream,
}

impl LocalCoreConnection {
    pub async fn receive_json(&mut self) -> Result<Option<Vec<u8>>, LocalCoreConnectionError> {
        self.inner.read_json().await.map_err(Into::into)
    }

    pub async fn send_json(&mut self, payload: &[u8]) -> Result<(), LocalCoreConnectionError> {
        self.inner.write_json(payload).await.map_err(Into::into)
    }
}

#[cfg(unix)]
impl From<AuthenticatedUnixStream> for LocalCoreConnection {
    fn from(inner: AuthenticatedUnixStream) -> Self {
        Self { inner }
    }
}

#[cfg(windows)]
impl From<AuthenticatedWindowsClientStream> for LocalCoreConnection {
    fn from(inner: AuthenticatedWindowsClientStream) -> Self {
        Self { inner }
    }
}
