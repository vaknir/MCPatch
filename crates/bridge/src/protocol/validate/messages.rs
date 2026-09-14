use std::collections::HashSet;

use super::formats::{validate_origin, validate_timestamp};
use super::{invalid, primitives::*};
use crate::protocol::{
    ApprovalRequired, ApprovalResult, Cancel, ConnectionError, ContextClosed, Heartbeat, Hello,
    HelloAck, ToolCall, ToolError, ToolResult, ValidationCode, ValidationError,
};

pub(super) fn validate_hello(message: &Hello) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_implementation(&message.implementation)?;
    validate_collection_size(
        &message.supported_protocol_versions,
        1,
        16,
        "supportedProtocolVersions",
    )?;

    let mut versions = HashSet::new();
    for version in &message.supported_protocol_versions {
        if *version == 0 || *version > i32::MAX as u32 {
            return Err(invalid(
                ValidationCode::InvalidValue,
                "supportedProtocolVersions",
            ));
        }
        if !versions.insert(*version) {
            return Err(invalid(
                ValidationCode::InvalidValue,
                "supportedProtocolVersions",
            ));
        }
    }

    if !versions.contains(&message.protocol_version) {
        return Err(invalid(
            ValidationCode::InvalidValue,
            "supportedProtocolVersions",
        ));
    }

    Ok(())
}

pub(super) fn validate_hello_ack(message: &HelloAck) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_protocol_version(message.selected_protocol_version)?;
    validate_identifier(&message.connection_id, "connectionId")?;
    validate_implementation(&message.implementation)
}

pub(super) fn validate_context_closed(message: &ContextClosed) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_identifier(&message.context_id, "contextId")?;
    validate_revision(message.context_revision, "contextRevision")
}

pub(super) fn validate_tool_call(message: &ToolCall) -> Result<(), ValidationError> {
    validate_route(
        message.protocol_version,
        &message.request_id,
        &message.context_id,
        message.context_revision,
        &message.origin,
    )?;
    validate_tool_name(&message.tool, "tool")?;
    validate_object_limit(message.args.len(), "args")
}

pub(super) fn validate_tool_result(message: &ToolResult) -> Result<(), ValidationError> {
    validate_route(
        message.protocol_version,
        &message.request_id,
        &message.context_id,
        message.context_revision,
        &message.origin,
    )
}

pub(super) fn validate_tool_error(message: &ToolError) -> Result<(), ValidationError> {
    validate_route(
        message.protocol_version,
        &message.request_id,
        &message.context_id,
        message.context_revision,
        &message.origin,
    )?;
    validate_bounded_text(Some(&message.message), 1, 512, "message")
}

pub(super) fn validate_cancel(message: &Cancel) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_identifier(&message.request_id, "requestId")
}

pub(super) fn validate_approval_required(
    message: &ApprovalRequired,
) -> Result<(), ValidationError> {
    validate_route(
        message.protocol_version,
        &message.request_id,
        &message.context_id,
        message.context_revision,
        &message.origin,
    )?;
    validate_identifier(&message.approval_id, "approvalId")?;
    validate_tool_name(&message.tool, "tool")?;
    validate_object_limit(message.arguments.len(), "arguments")?;
    if !valid_lower_hex(&message.args_hash, 64) {
        return Err(invalid(ValidationCode::InvalidValue, "argsHash"));
    }
    validate_timestamp(&message.expires_at, "expiresAt")
}

pub(super) fn validate_approval_result(message: &ApprovalResult) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_identifier(&message.approval_id, "approvalId")?;
    validate_identifier(&message.request_id, "requestId")
}

pub(super) fn validate_heartbeat(message: &Heartbeat) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_identifier(&message.heartbeat_id, "heartbeatId")?;
    validate_timestamp(&message.sent_at, "sentAt")
}

pub(super) fn validate_connection_error(message: &ConnectionError) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_bounded_text(Some(&message.message), 1, 512, "message")
}

fn validate_route(
    protocol_version: u32,
    request_id: &str,
    context_id: &str,
    context_revision: u64,
    origin: &str,
) -> Result<(), ValidationError> {
    validate_protocol_version(protocol_version)?;
    validate_identifier(request_id, "requestId")?;
    validate_identifier(context_id, "contextId")?;
    validate_revision(context_revision, "contextRevision")?;
    validate_origin(origin, "origin")
}
