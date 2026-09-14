use thiserror::Error;

use super::{CallerOriginError, LocalBrowserChannelError, NativeMessageError};

/// Failures at the Native Messaging adapter boundary.
#[derive(Debug, Error)]
pub enum NativeHostError {
    #[error("caller origin rejected")]
    CallerOrigin(#[source] CallerOriginError),
    #[error("local browser channel failed")]
    LocalChannel(#[source] LocalBrowserChannelError),
    #[error("Native Messaging frame failed")]
    Message(#[source] NativeMessageError),
}

impl NativeHostError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::CallerOrigin(error) => error.code(),
            Self::LocalChannel(error) => match error.code() {
                super::LocalBrowserChannelErrorCode::Backpressure => "local_ipc_backpressure",
                super::LocalBrowserChannelErrorCode::Closed => "local_ipc_closed",
                super::LocalBrowserChannelErrorCode::Transport => "local_ipc_transport_failed",
                super::LocalBrowserChannelErrorCode::Unavailable => "local_ipc_unavailable",
            },
            Self::Message(error) => error.code().as_str(),
        }
    }
}
