use std::io;

use thiserror::Error;

/// Stable local-frame failure categories.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalFrameErrorCode {
    EmptyMessage,
    InvalidJson,
    MessageTooLarge,
    ReadFailed,
    TruncatedHeader,
    TruncatedPayload,
    WriteFailed,
}

/// A local framing failure that does not expose payload bytes.
#[derive(Debug, Error)]
#[error("local IPC frame failed: {code:?}")]
pub struct LocalFrameError {
    code: LocalFrameErrorCode,
    #[source]
    source: Option<io::Error>,
}

impl LocalFrameError {
    pub const fn code(&self) -> LocalFrameErrorCode {
        self.code
    }

    pub(crate) const fn without_source(code: LocalFrameErrorCode) -> Self {
        Self { code, source: None }
    }

    pub(crate) fn with_source(code: LocalFrameErrorCode, source: io::Error) -> Self {
        Self {
            code,
            source: Some(source),
        }
    }
}

/// Stable Unix endpoint and peer-authentication failure categories.
#[cfg(unix)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnixIpcErrorCode {
    CoreAlreadyRunning,
    EndpointInUse,
    EndpointUnavailable,
    Io,
    PeerCredentialsUnavailable,
    PeerUnauthorized,
    RuntimeUnavailable,
    UnsafeEndpoint,
    UnsafeLock,
    UnsafeRuntimeDirectory,
}

/// A path- and identity-free Unix IPC failure safe for structured logs.
#[cfg(unix)]
#[derive(Debug, Error)]
#[error("Unix local IPC failed: {code:?}")]
pub struct UnixIpcError {
    code: UnixIpcErrorCode,
    #[source]
    source: Option<io::Error>,
}

#[cfg(unix)]
impl UnixIpcError {
    pub const fn code(&self) -> UnixIpcErrorCode {
        self.code
    }

    pub(crate) const fn without_source(code: UnixIpcErrorCode) -> Self {
        Self { code, source: None }
    }

    pub(crate) fn with_source(code: UnixIpcErrorCode, source: io::Error) -> Self {
        Self {
            code,
            source: Some(source),
        }
    }
}

/// Stable Windows endpoint and peer-authentication failure categories.
#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindowsIpcErrorCode {
    CoreAlreadyRunning,
    EndpointInUse,
    IdentityUnavailable,
    Io,
    MutexUnavailable,
    PeerUnauthorized,
    RevertFailed,
    SecurityDescriptorUnavailable,
    WorkerFailed,
}

/// A pipe-name- and identity-free Windows IPC failure safe for structured logs.
#[cfg(windows)]
#[derive(Debug, Error)]
#[error("Windows local IPC failed: {code:?}")]
pub struct WindowsIpcError {
    code: WindowsIpcErrorCode,
    #[source]
    source: Option<io::Error>,
}

#[cfg(windows)]
impl WindowsIpcError {
    pub const fn code(&self) -> WindowsIpcErrorCode {
        self.code
    }

    pub(crate) const fn without_source(code: WindowsIpcErrorCode) -> Self {
        Self { code, source: None }
    }

    pub(crate) fn with_source(code: WindowsIpcErrorCode, source: io::Error) -> Self {
        Self {
            code,
            source: Some(source),
        }
    }
}
