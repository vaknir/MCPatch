use std::{fmt, sync::Arc};

use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::{
    browser::{
        BrowserConnection, BrowserConnectionError, BrowserConnectionErrorCode, BrowserConnectionId,
    },
    protocol::{
        ApprovalRequired, Cancel, Capability, JsonObject, Message, ToolCall, ToolError, ToolResult,
    },
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
    completion: oneshot::Receiver<Result<BrowserToolResponse, RoutedCallCompletionError>>,
    message: ToolCall,
    revocation: CancellationToken,
}

pub enum CallReservation {
    Approval(RoutedApproval),
    Call(RoutedCall),
}

pub struct RoutedApproval {
    connection: Arc<dyn BrowserConnection>,
    completion: oneshot::Receiver<Result<ApprovalGrant, ApprovalCompletionError>>,
    message: ApprovalRequired,
    revocation: CancellationToken,
}

impl RoutedApproval {
    pub(crate) fn new(
        connection: Arc<dyn BrowserConnection>,
        completion: oneshot::Receiver<Result<ApprovalGrant, ApprovalCompletionError>>,
        message: ApprovalRequired,
        revocation: CancellationToken,
    ) -> Self {
        Self {
            connection,
            completion,
            message,
            revocation,
        }
    }

    pub fn message(&self) -> &ApprovalRequired {
        &self.message
    }

    pub fn revocation(&self) -> CancellationToken {
        self.revocation.clone()
    }

    pub async fn completion(self) -> Result<ApprovalGrant, ApprovalCompletionError> {
        self.completion
            .await
            .unwrap_or(Err(ApprovalCompletionError::Revoked))
    }

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
            result = self.connection.send(Message::ApprovalRequired(self.message.clone())) => result,
        }
    }
}

impl fmt::Debug for RoutedApproval {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RoutedApproval")
            .field("connection_id", self.connection.id())
            .field("request_id", &self.message.request_id)
            .field("context_id", &self.message.context_id)
            .field("context_revision", &self.message.context_revision)
            .field("tool", &self.message.tool)
            .field("revoked", &self.revocation.is_cancelled())
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalCompletionError {
    Denied,
    Expired,
    Revoked,
}

pub struct ApprovalGrant {
    pub(super) binding: ApprovalBinding,
}

impl fmt::Debug for ApprovalGrant {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApprovalGrant")
            .field("request_id", &self.binding.invocation.request_id)
            .field("context_id", &self.binding.context_id)
            .field("context_revision", &self.binding.context_revision)
            .field("tool", &self.binding.invocation.tool)
            .finish_non_exhaustive()
    }
}

pub(super) struct ApprovalBinding {
    pub approval_id: String,
    pub protocol_version: u32,
    pub policy_version: u32,
    pub connection_id: BrowserConnectionId,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub capability: Capability,
    pub invocation: ToolInvocation,
    pub args_hash: [u8; 32],
    pub issued_at: time::OffsetDateTime,
    pub expires_at: time::OffsetDateTime,
}

impl RoutedCall {
    pub(crate) fn new(
        connection: Arc<dyn BrowserConnection>,
        completion: oneshot::Receiver<Result<BrowserToolResponse, RoutedCallCompletionError>>,
        message: ToolCall,
        revocation: CancellationToken,
    ) -> Self {
        Self {
            connection,
            completion,
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

    pub async fn completion(self) -> Result<BrowserToolResponse, RoutedCallCompletionError> {
        self.completion
            .await
            .unwrap_or(Err(RoutedCallCompletionError::Revoked))
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoutedCallCompletionError {
    ResultInvalid,
    Revoked,
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
    pub completion: oneshot::Sender<Result<BrowserToolResponse, RoutedCallCompletionError>>,
    pub connection_id: BrowserConnectionId,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub output_validator: Option<Arc<jsonschema::Validator>>,
    pub revocation: CancellationToken,
}

pub(super) struct PendingApproval {
    pub binding: ApprovalBinding,
    pub completion: oneshot::Sender<Result<ApprovalGrant, ApprovalCompletionError>>,
    pub revocation: CancellationToken,
}
