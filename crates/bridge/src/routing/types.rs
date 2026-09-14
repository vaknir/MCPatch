use std::{fmt, sync::Arc};

use tokio_util::sync::CancellationToken;

use crate::{
    browser::{
        BrowserConnection, BrowserConnectionError, BrowserConnectionErrorCode, BrowserConnectionId,
    },
    protocol::{Cancel, JsonObject, Message, ToolCall, ToolError, ToolResult},
};

#[derive(Clone, Debug, PartialEq)]
pub struct ToolInvocation {
    pub request_id: String,
    pub tool: String,
    pub arguments: JsonObject,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BrowserToolResponse {
    Result(ToolResult),
    Error(ToolError),
}

impl BrowserToolResponse {
    pub(crate) fn request_id(&self) -> &str {
        match self {
            Self::Result(result) => &result.request_id,
            Self::Error(error) => &error.request_id,
        }
    }

    pub(crate) fn context_id(&self) -> &str {
        match self {
            Self::Result(result) => &result.context_id,
            Self::Error(error) => &error.context_id,
        }
    }

    pub(crate) fn context_revision(&self) -> u64 {
        match self {
            Self::Result(result) => result.context_revision,
            Self::Error(error) => error.context_revision,
        }
    }

    pub(crate) fn origin(&self) -> &str {
        match self {
            Self::Result(result) => &result.origin,
            Self::Error(error) => &error.origin,
        }
    }
}

pub struct RoutedCall {
    connection: Arc<dyn BrowserConnection>,
    message: ToolCall,
    revocation: CancellationToken,
}

impl RoutedCall {
    pub(crate) fn new(
        connection: Arc<dyn BrowserConnection>,
        message: ToolCall,
        revocation: CancellationToken,
    ) -> Self {
        Self {
            connection,
            message,
            revocation,
        }
    }

    pub fn message(&self) -> &ToolCall {
        &self.message
    }

    pub fn revocation(&self) -> CancellationToken {
        self.revocation.clone()
    }

    /// Send the route unless its context or connection has already been revoked.
    pub async fn dispatch(&self) -> Result<(), BrowserConnectionError> {
        if self.revocation.is_cancelled() {
            return Err(BrowserConnectionError::new(
                BrowserConnectionErrorCode::Closed,
            ));
        }
        tokio::select! {
            biased;
            _ = self.revocation.cancelled() => {
                Err(BrowserConnectionError::new(BrowserConnectionErrorCode::Closed))
            }
            result = self.connection.send(Message::ToolCall(self.message.clone())) => result,
        }
    }
}

impl fmt::Debug for RoutedCall {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RoutedCall")
            .field("connection_id", self.connection.id())
            .field("request_id", &self.message.request_id)
            .field("context_id", &self.message.context_id)
            .field("context_revision", &self.message.context_revision)
            .field("tool", &self.message.tool)
            .field("revoked", &self.revocation.is_cancelled())
            .finish()
    }
}

pub struct RoutedCancellation {
    connection: Arc<dyn BrowserConnection>,
    message: Cancel,
}

impl RoutedCancellation {
    pub(crate) fn new(connection: Arc<dyn BrowserConnection>, message: Cancel) -> Self {
        Self {
            connection,
            message,
        }
    }

    pub fn message(&self) -> &Cancel {
        &self.message
    }

    pub async fn dispatch(&self) -> Result<(), BrowserConnectionError> {
        self.connection
            .send(Message::Cancel(self.message.clone()))
            .await
    }
}

impl fmt::Debug for RoutedCancellation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RoutedCancellation")
            .field("connection_id", self.connection.id())
            .field("request_id", &self.message.request_id)
            .finish()
    }
}

#[derive(Debug, Default)]
pub struct RegistryChange {
    pub changed: bool,
    pub cancellations: Vec<RoutedCancellation>,
}

pub(super) struct ActiveRequest {
    pub connection_id: BrowserConnectionId,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub output_validator: Option<jsonschema::Validator>,
    pub revocation: CancellationToken,
}
