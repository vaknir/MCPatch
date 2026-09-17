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
            Self::LocalChannel(error) => error.code().as_str(),
            Self::Message(error) => error.code().as_str(),
        }
    }

    /// Fixed, path-free guidance for failures an operator can correct.
    pub const fn operator_hint(&self) -> Option<&'static str> {
        match self {
            Self::LocalChannel(error) => error.code().operator_hint(),
            Self::CallerOrigin(_) | Self::Message(_) => None,
        }
    }
}
