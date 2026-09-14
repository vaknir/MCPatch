mod capability;
mod formats;
mod messages;
mod primitives;

use super::{Message, ValidationCode, ValidationError};

pub(super) const MAX_CAPABILITIES: usize = 256;
pub(super) const MAX_TOP_LEVEL_PROPERTIES: usize = 128;

impl Message {
    /// Enforce protocol invariants that are stricter than JSON shape validation.
    pub fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::Hello(message) => messages::validate_hello(message),
            Self::HelloAck(message) => messages::validate_hello_ack(message),
            Self::CapabilitySnapshot(message) => capability::validate_capability_snapshot(message),
            Self::ContextClosed(message) => messages::validate_context_closed(message),
            Self::ToolCall(message) => messages::validate_tool_call(message),
            Self::ToolResult(message) => messages::validate_tool_result(message),
            Self::ToolError(message) => messages::validate_tool_error(message),
            Self::Cancel(message) => messages::validate_cancel(message),
            Self::ApprovalRequired(message) => messages::validate_approval_required(message),
            Self::ApprovalResult(message) => messages::validate_approval_result(message),
            Self::Heartbeat(message) => messages::validate_heartbeat(message),
            Self::ConnectionError(message) => messages::validate_connection_error(message),
        }
    }
}

pub(super) fn invalid(code: ValidationCode, field: impl Into<String>) -> ValidationError {
    ValidationError::new(code, field)
}
