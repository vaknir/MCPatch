use std::collections::HashSet;

use semver::Version;

use super::formats::validate_origin;
use super::primitives::{
    valid_lower_hex, valid_pack_id, valid_publisher, validate_bounded_text,
    validate_collection_size, validate_identifier, validate_input_schema, validate_object_limit,
    validate_protocol_version, validate_revision, validate_tool_name,
};
use super::{MAX_CAPABILITIES, invalid};
use crate::protocol::{
    Capability, CapabilitySnapshot, CapabilitySource, PackReference, Permission, Risk,
    ValidationCode, ValidationError,
};

pub(super) fn validate_capability_snapshot(
    message: &CapabilitySnapshot,
) -> Result<(), ValidationError> {
    validate_protocol_version(message.protocol_version)?;
    validate_identifier(&message.context_id, "contextId")?;
    validate_revision(message.context_revision, "contextRevision")?;
    validate_origin(&message.origin, "origin")?;

    if message.capabilities.len() > MAX_CAPABILITIES {
        return Err(invalid(ValidationCode::LimitExceeded, "capabilities"));
    }

    let mut names = HashSet::new();
    for (index, capability) in message.capabilities.iter().enumerate() {
        let prefix = format!("capabilities[{index}]");
        validate_capability(capability, &message.origin, &prefix)?;
        if !names.insert(&capability.name) {
            return Err(invalid(
                ValidationCode::InvalidCapability,
                format!("{prefix}.name"),
            ));
        }
    }

    Ok(())
}

fn validate_capability(
    capability: &Capability,
    context_origin: &str,
    prefix: &str,
) -> Result<(), ValidationError> {
    validate_tool_name(&capability.name, format!("{prefix}.name"))?;
    validate_bounded_text(
        capability.title.as_deref(),
        1,
        128,
        format!("{prefix}.title"),
    )?;
    validate_bounded_text(
        Some(&capability.description),
        1,
        1024,
        format!("{prefix}.description"),
    )?;
    validate_origin(&capability.origin, format!("{prefix}.origin"))?;
    if capability.origin != context_origin {
        return Err(invalid(
            ValidationCode::InvalidCapability,
            format!("{prefix}.origin"),
        ));
    }

    match (capability.source, &capability.pack) {
        (CapabilitySource::Pack, Some(pack)) => {
            // A pack result reaches the MCP client only through its declared
            // output schema, so a pack capability without one has no allowlist.
            if capability.output_schema.is_none() {
                return Err(invalid(
                    ValidationCode::InvalidCapability,
                    format!("{prefix}.outputSchema"),
                ));
            }
            validate_pack(pack, prefix)?;
        }
        (CapabilitySource::NativeWebMcp, None) => {}
        _ => {
            return Err(invalid(
                ValidationCode::InvalidCapability,
                format!("{prefix}.pack"),
            ));
        }
    }

    validate_collection_size(
        &capability.permissions,
        1,
        6,
        &format!("{prefix}.permissions"),
    )?;
    let permissions: HashSet<_> = capability.permissions.iter().copied().collect();
    if permissions.len() != capability.permissions.len() {
        return Err(invalid(
            ValidationCode::InvalidCapability,
            format!("{prefix}.permissions"),
        ));
    }

    let required_permission = match capability.risk {
        Risk::Read => Permission::Read,
        Risk::Action => Permission::Action,
        Risk::Sensitive => Permission::Sensitive,
    };
    if !permissions.contains(&required_permission) {
        return Err(invalid(
            ValidationCode::InvalidCapability,
            format!("{prefix}.risk"),
        ));
    }

    validate_input_schema(&capability.input_schema, format!("{prefix}.inputSchema"))?;
    if let Some(output_schema) = &capability.output_schema {
        validate_object_limit(output_schema.len(), format!("{prefix}.outputSchema"))?;
    }

    Ok(())
}

fn validate_pack(pack: &PackReference, prefix: &str) -> Result<(), ValidationError> {
    if !valid_publisher(&pack.publisher) {
        return Err(invalid(
            ValidationCode::InvalidValue,
            format!("{prefix}.pack.publisher"),
        ));
    }
    if !valid_pack_id(&pack.id) {
        return Err(invalid(
            ValidationCode::InvalidValue,
            format!("{prefix}.pack.id"),
        ));
    }
    if pack.version.len() > 64 || Version::parse(&pack.version).is_err() {
        return Err(invalid(
            ValidationCode::InvalidValue,
            format!("{prefix}.pack.version"),
        ));
    }
    if !pack.digest.starts_with("sha256:") || !valid_lower_hex(&pack.digest[7..], 64) {
        return Err(invalid(
            ValidationCode::InvalidValue,
            format!("{prefix}.pack.digest"),
        ));
    }
    Ok(())
}
