use serde_json::Value;

use super::{MAX_TOP_LEVEL_PROPERTIES, invalid};
use crate::protocol::{Implementation, PROTOCOL_VERSION, ValidationCode, ValidationError};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(super) fn validate_protocol_version(version: u32) -> Result<(), ValidationError> {
    if version != PROTOCOL_VERSION {
        return Err(invalid(
            ValidationCode::UnsupportedVersion,
            "protocolVersion",
        ));
    }
    Ok(())
}

pub(super) fn validate_revision(revision: u64, field: &str) -> Result<(), ValidationError> {
    if revision == 0 || revision > MAX_SAFE_INTEGER {
        return Err(invalid(ValidationCode::InvalidValue, field));
    }
    Ok(())
}

pub(super) fn validate_supported_version(version: u32, field: &str) -> Result<(), ValidationError> {
    if version == 0 || version > i32::MAX as u32 {
        return Err(invalid(ValidationCode::InvalidValue, field));
    }
    Ok(())
}

pub(super) fn validate_implementation(
    implementation: &Implementation,
) -> Result<(), ValidationError> {
    if !valid_identifier(&implementation.name, 64) {
        return Err(invalid(
            ValidationCode::InvalidIdentifier,
            "implementation.name",
        ));
    }
    validate_bounded_text(
        Some(&implementation.version),
        1,
        64,
        "implementation.version",
    )
}

pub(super) fn validate_identifier(
    value: &str,
    field: impl Into<String>,
) -> Result<(), ValidationError> {
    if !valid_identifier(value, 128) {
        return Err(invalid(ValidationCode::InvalidIdentifier, field));
    }
    Ok(())
}

fn valid_identifier(value: &str, max: usize) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= max
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

pub(super) fn validate_tool_name(
    value: &str,
    field: impl Into<String>,
) -> Result<(), ValidationError> {
    let valid = (3..=128).contains(&value.len())
        && value.split('.').count() >= 2
        && value.split('.').all(|segment| {
            let bytes = segment.as_bytes();
            !bytes.is_empty()
                && bytes[0].is_ascii_lowercase()
                && bytes
                    .iter()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
        });
    if !valid {
        return Err(invalid(ValidationCode::InvalidIdentifier, field));
    }
    Ok(())
}

pub(super) fn validate_input_schema(
    schema: &serde_json::Map<String, Value>,
    field: impl Into<String>,
) -> Result<(), ValidationError> {
    let field = field.into();
    validate_object_limit(schema.len(), &field)?;
    if schema.get("type") != Some(&Value::String("object".to_owned())) {
        return Err(invalid(ValidationCode::InvalidSchema, field));
    }
    Ok(())
}

pub(super) fn validate_object_limit(
    properties: usize,
    field: impl Into<String>,
) -> Result<(), ValidationError> {
    if properties > MAX_TOP_LEVEL_PROPERTIES {
        return Err(invalid(ValidationCode::LimitExceeded, field));
    }
    Ok(())
}

pub(super) fn validate_collection_size<T>(
    values: &[T],
    minimum: usize,
    maximum: usize,
    field: &str,
) -> Result<(), ValidationError> {
    if !(minimum..=maximum).contains(&values.len()) {
        return Err(invalid(ValidationCode::LimitExceeded, field));
    }
    Ok(())
}

pub(super) fn validate_bounded_text(
    value: Option<&str>,
    minimum: usize,
    maximum: usize,
    field: impl Into<String>,
) -> Result<(), ValidationError> {
    if let Some(value) = value {
        let length = value.chars().count();
        if !(minimum..=maximum).contains(&length) {
            return Err(invalid(ValidationCode::LimitExceeded, field));
        }
    }
    Ok(())
}

pub(super) fn valid_publisher(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=128).contains(&bytes.len())
        && is_ascii_lowercase_or_digit(bytes[0])
        && is_ascii_lowercase_or_digit(bytes[bytes.len() - 1])
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
}

pub(super) fn valid_pack_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=64).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && is_ascii_lowercase_or_digit(bytes[bytes.len() - 1])
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

pub(super) fn valid_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_ascii_lowercase_or_digit(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::{valid_identifier, validate_tool_name};

    #[test]
    fn identifiers_are_ascii_and_bounded() {
        assert!(valid_identifier("request-01J8QAZ6V4F2K7M3", 128));
        assert!(!valid_identifier("request id", 128));
        assert!(!valid_identifier("", 128));
        assert!(!valid_identifier("é", 128));
    }

    #[test]
    fn tool_names_are_namespaced() {
        assert!(validate_tool_name("flights.current_search", "tool").is_ok());
        assert!(validate_tool_name("current_search", "tool").is_err());
        assert!(validate_tool_name("Flights.search", "tool").is_err());
    }
}
