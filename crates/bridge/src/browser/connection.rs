use std::fmt;

use futures_util::future::BoxFuture;
use thiserror::Error;

use crate::protocol::{Message, valid_identifier};

/// Bridge-assigned identity for one browser connection lifetime.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct BrowserConnectionId(String);

impl BrowserConnectionId {
    pub fn parse(value: impl Into<String>) -> Result<Self, InvalidBrowserConnectionId> {
        let value = value.into();
        if !valid_identifier(&value, 128) {
            return Err(InvalidBrowserConnectionId);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for BrowserConnectionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("invalid browser connection identifier")]
pub struct InvalidBrowserConnectionId;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BrowserConnectionErrorCode {
    Backpressure,
    Closed,
    InvalidMessage,
    Transport,
}

/// Stable, payload-free connection failure suitable for audit-safe handling.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("browser connection failed: {code:?}")]
pub struct BrowserConnectionError {
    code: BrowserConnectionErrorCode,
}

impl BrowserConnectionError {
    pub const fn new(code: BrowserConnectionErrorCode) -> Self {
        Self { code }
    }

    pub const fn code(self) -> BrowserConnectionErrorCode {
        self.code
    }
}

/// An established, framed browser protocol channel.
///
/// Implementations must bound their queues and validate every typed message at
/// both ingress and egress. Framing, browser APIs, and DOM behavior stay behind
/// the adapter and never enter the policy or routing core.
pub trait BrowserConnection: Send + Sync {
    fn id(&self) -> &BrowserConnectionId;

    fn send(&self, message: Message) -> BoxFuture<'_, Result<(), BrowserConnectionError>>;

    fn receive(&self) -> BoxFuture<'_, Result<Option<Message>, BrowserConnectionError>>;

    fn close(&self) -> BoxFuture<'_, Result<(), BrowserConnectionError>>;
}
