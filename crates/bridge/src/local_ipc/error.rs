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
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnixIpcErrorCode {
    EndpointInUse,
    EndpointUnavailable,
    Io,
    PeerCredentialsUnavailable,
    PeerUnauthorized,
    RuntimeUnavailable,
    UnsafeEndpoint,
    UnsafeRuntimeDirectory,
}

/// A path- and identity-free Unix IPC failure safe for structured logs.
#[derive(Debug, Error)]
#[error("Unix local IPC failed: {code:?}")]
pub struct UnixIpcError {
    code: UnixIpcErrorCode,
    #[source]
    source: Option<io::Error>,
}

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
