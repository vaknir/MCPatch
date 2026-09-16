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

/// Fixed, path-free guidance for a runtime directory that could not be found.
///
/// Hints are logged next to a stable code so an operator can act without the
/// bridge ever writing a filesystem path, user name, or environment value.
pub const RUNTIME_DIRECTORY_UNAVAILABLE_HINT: &str = "Set XDG_RUNTIME_DIR, or the MCPATCH_RUNTIME_DIR override, to an existing directory owned by the current user with mode 0700";

/// Fixed, path-free guidance for a runtime directory that failed its safety checks.
pub const RUNTIME_DIRECTORY_UNSAFE_HINT: &str = "The runtime directory and its MCPatch subdirectories must be owned by the current user with mode 0700 and contain no symlinked endpoints";

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

#[cfg(unix)]
impl UnixIpcErrorCode {
    /// Stable bridge-core startup code for structured logs. Runtime-directory
    /// failures are distinguished because an operator can fix them; every other
    /// failure stays under the transport code so logs never hint at internals.
    pub const fn core_startup_code(self) -> &'static str {
        match self {
            Self::RuntimeUnavailable => "core_runtime_directory_unavailable",
            Self::UnsafeRuntimeDirectory => "core_runtime_directory_unsafe",
            _ => "core_transport_failed",
        }
    }

    /// Fixed guidance for failures an operator can correct in the environment.
    pub const fn operator_hint(self) -> Option<&'static str> {
        match self {
            Self::RuntimeUnavailable => Some(RUNTIME_DIRECTORY_UNAVAILABLE_HINT),
            Self::UnsafeRuntimeDirectory => Some(RUNTIME_DIRECTORY_UNSAFE_HINT),
            _ => None,
        }
    }
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
    EndpointUnavailable,
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
