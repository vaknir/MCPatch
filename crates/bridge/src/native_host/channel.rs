use futures_util::future::BoxFuture;
use thiserror::Error;

use crate::protocol::Message;

/// Stable failures from the injected local browser IPC boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalBrowserChannelErrorCode {
    Backpressure,
    Closed,
    Transport,
    Unavailable,
}

/// Payload-free local IPC error suitable for audit-safe handling.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("local browser channel failed: {code:?}")]
pub struct LocalBrowserChannelError {
    code: LocalBrowserChannelErrorCode,
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
/// Issue #37 supplies the OS-specific implementation. Keeping this interface
/// injected prevents Native Messaging framing from depending on rendezvous.
pub trait LocalBrowserChannel: Send + Sync {
    fn send(&self, message: Message) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>>;

    fn receive(&self) -> BoxFuture<'_, Result<Option<Message>, LocalBrowserChannelError>>;

    fn close(&self) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>>;
}

/// Fail-closed placeholder used until local IPC rendezvous is implemented.
pub struct UnavailableLocalBrowserChannel;

impl LocalBrowserChannel for UnavailableLocalBrowserChannel {
    fn send(&self, _message: Message) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>> {
        Box::pin(async {
            Err(LocalBrowserChannelError::new(
                LocalBrowserChannelErrorCode::Unavailable,
            ))
        })
    }

    fn receive(&self) -> BoxFuture<'_, Result<Option<Message>, LocalBrowserChannelError>> {
        Box::pin(std::future::pending())
    }

    fn close(&self) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>> {
        Box::pin(async { Ok(()) })
    }
}
