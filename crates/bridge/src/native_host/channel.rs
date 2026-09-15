use futures_util::future::BoxFuture;
use thiserror::Error;

use crate::{
    local_ipc::{
        CoreRendezvousError, CoreRendezvousErrorCode, LocalCoreConnectionError,
        LocalCoreConnectionErrorCode,
    },
    protocol::Message,
};

/// Stable failures from the injected local browser IPC boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalBrowserChannelErrorCode {
    Backpressure,
    Closed,
    Malformed,
    SpawnFailed,
    StartupEntropyUnavailable,
    StartupTimeout,
    Transport,
    Unavailable,
    Unauthorized,
    UnsafeRuntime,
}

impl LocalBrowserChannelErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Backpressure => "local_ipc_backpressure",
            Self::Closed => "local_ipc_closed",
            Self::Malformed => "local_core_malformed_frame",
            Self::SpawnFailed => "core_spawn_failed",
            Self::StartupEntropyUnavailable => "core_startup_entropy_unavailable",
            Self::StartupTimeout => "core_startup_timeout",
            Self::Transport => "local_core_transport_failed",
            Self::Unavailable => "local_core_unavailable",
            Self::Unauthorized => "local_core_unauthorized",
            Self::UnsafeRuntime => "local_core_runtime_unsafe",
        }
    }
}

/// Payload-free local IPC error suitable for audit-safe handling.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("local browser channel failed: {code:?}")]
pub struct LocalBrowserChannelError {
    code: LocalBrowserChannelErrorCode,
}

impl From<CoreRendezvousError> for LocalBrowserChannelError {
    fn from(error: CoreRendezvousError) -> Self {
        let code = match error.code() {
            CoreRendezvousErrorCode::Connection(code) => map_connection_code(code),
            CoreRendezvousErrorCode::EntropyUnavailable => {
                LocalBrowserChannelErrorCode::StartupEntropyUnavailable
            }
            CoreRendezvousErrorCode::SpawnFailed => LocalBrowserChannelErrorCode::SpawnFailed,
            CoreRendezvousErrorCode::StartupTimeout => LocalBrowserChannelErrorCode::StartupTimeout,
        };
        Self::new(code)
    }
}

impl From<LocalCoreConnectionError> for LocalBrowserChannelError {
    fn from(error: LocalCoreConnectionError) -> Self {
        Self::new(map_connection_code(error.code()))
    }
}

const fn map_connection_code(code: LocalCoreConnectionErrorCode) -> LocalBrowserChannelErrorCode {
    match code {
        LocalCoreConnectionErrorCode::MalformedFrame => LocalBrowserChannelErrorCode::Malformed,
        LocalCoreConnectionErrorCode::Transport => LocalBrowserChannelErrorCode::Transport,
        LocalCoreConnectionErrorCode::Unauthorized => LocalBrowserChannelErrorCode::Unauthorized,
        LocalCoreConnectionErrorCode::Unavailable => LocalBrowserChannelErrorCode::Unavailable,
        LocalCoreConnectionErrorCode::UnsafeRuntime => LocalBrowserChannelErrorCode::UnsafeRuntime,
    }
}

impl LocalBrowserChannelError {
    pub const fn new(code: LocalBrowserChannelErrorCode) -> Self {
        Self { code }
    }

    pub const fn code(self) -> LocalBrowserChannelErrorCode {
        self.code
    }
}

/// Native-host side of the local, bounded bridge-protocol connection.
///
/// Keeping this interface injected lets lifecycle tests exercise framing and
/// failure behavior without opening an operating-system endpoint.
pub trait LocalBrowserChannel: Send + Sync {
    fn send(&self, message: Message) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>>;

    fn receive(&self) -> BoxFuture<'_, Result<Option<Message>, LocalBrowserChannelError>>;

    fn close(&self) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>>;
}

/// Creates the authenticated local channel only after caller and first-frame validation.
pub trait LocalBrowserChannelFactory: Send + Sync {
    fn connect(
        &self,
    ) -> BoxFuture<'_, Result<std::sync::Arc<dyn LocalBrowserChannel>, LocalBrowserChannelError>>;
}

#[cfg(test)]
mod tests {
    use super::LocalBrowserChannelErrorCode as Code;

    #[test]
    fn local_channel_error_codes_are_stable() {
        for (code, expected) in [
            (Code::Backpressure, "local_ipc_backpressure"),
            (Code::Closed, "local_ipc_closed"),
            (Code::Malformed, "local_core_malformed_frame"),
            (Code::SpawnFailed, "core_spawn_failed"),
            (
                Code::StartupEntropyUnavailable,
                "core_startup_entropy_unavailable",
            ),
            (Code::StartupTimeout, "core_startup_timeout"),
            (Code::Transport, "local_core_transport_failed"),
            (Code::Unavailable, "local_core_unavailable"),
            (Code::Unauthorized, "local_core_unauthorized"),
            (Code::UnsafeRuntime, "local_core_runtime_unsafe"),
        ] {
            assert_eq!(code.as_str(), expected);
        }
    }
}
