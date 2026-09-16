use std::collections::HashSet;

use super::formats::{validate_origin, validate_timestamp};
use super::{invalid, primitives::*};
use crate::protocol::{
    ApprovalRequired, ApprovalResult, Cancel, ConnectionError, ContextClosed, Heartbeat, Hello,
    HelloAck, ToolCall, ToolContent, ToolError, ToolResult, ValidationCode, ValidationError,
};

const MAX_IMAGE_DIMENSION: u32 = 2_048;
const MAX_IMAGE_BYTES: usize = 160 * 1_024;

pub(super) fn validate_hello(message: &Hello) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_implementation(&message.implementation)?;
    validate_supported_protocol_versions(&message.supported_protocol_versions)
}

pub(super) fn validate_hello_ack(message: &HelloAck) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_supported_protocol_versions(&message.supported_protocol_versions)?;
    validate_supported_version(message.selected_protocol_version, "selectedProtocolVersion")?;
    validate_identifier(&message.connection_id, "connectionId")?;
    validate_implementation(&message.implementation)
}

fn validate_supported_protocol_versions(versions: &[u32]) -> Result<(), ValidationError> {
    validate_collection_size(versions, 1, 16, "supportedProtocolVersions")?;
    let mut unique = HashSet::new();
    for version in versions {
        validate_supported_version(*version, "supportedProtocolVersions")?;
        if !unique.insert(*version) {
            return Err(invalid(
                ValidationCode::InvalidValue,
                "supportedProtocolVersions",
            ));
        }
    }
    Ok(())
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
    )?;
    validate_collection_size(&message.content, 0, 1, "content")?;
    for content in &message.content {
        match content {
            ToolContent::Image(image) => validate_image_content(image)?,
        }
    }
    Ok(())
}

fn validate_image_content(
    image: &crate::protocol::ToolImageContent,
) -> Result<(), ValidationError> {
    if !matches!(image.mime_type.as_str(), "image/png" | "image/webp") {
        return Err(invalid(ValidationCode::InvalidValue, "content.mimeType"));
    }
    if image.width == 0
        || image.width > MAX_IMAGE_DIMENSION
        || image.height == 0
        || image.height > MAX_IMAGE_DIMENSION
    {
        return Err(invalid(ValidationCode::LimitExceeded, "content.dimensions"));
    }
    if !valid_bounded_base64(&image.data, MAX_IMAGE_BYTES) {
        return Err(invalid(ValidationCode::InvalidValue, "content.data"));
    }
    Ok(())
}

fn valid_bounded_base64(value: &str, maximum_bytes: usize) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 4 || !bytes.len().is_multiple_of(4) {
        return false;
    }
    let padding = if bytes.ends_with(b"==") {
        2
    } else if bytes.ends_with(b"=") {
        1
    } else {
        0
    };
    let data_length = bytes.len() - padding;
    if bytes[..data_length]
        .iter()
        .any(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'+' | b'/'))
        || bytes[data_length..].iter().any(|byte| *byte != b'=')
    {
        return false;
    }
    bytes.len() / 4 * 3 - padding <= maximum_bytes
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
