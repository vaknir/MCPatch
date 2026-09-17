use serde_json::Value;

use super::{MAX_TOP_LEVEL_PROPERTIES, invalid};
use crate::protocol::{
    Implementation, PROTOCOL_VERSION, ValidationCode, ValidationError, valid_identifier,
};

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

/// Keywords the extension's codegen-free interpreter understands. The bridge
/// enforces the same allowlist so its own validator never compiles a keyword
/// the extension would refuse, even if an extension build is buggy or hostile.
const RUNTIME_SCHEMA_KEYWORDS: [&str; 15] = [
    "additionalProperties",
    "const",
    "enum",
    "items",
    "maximum",
    "maxItems",
    "maxLength",
    "maxProperties",
    "minimum",
    "minItems",
    "minLength",
    "minProperties",
    "properties",
    "required",
    "type",
];
const JSON_TYPES: [&str; 7] = [
    "array", "boolean", "integer", "null", "number", "object", "string",
];

pub(super) fn validate_input_schema(
    schema: &serde_json::Map<String, Value>,
    field: impl Into<String>,
) -> Result<(), ValidationError> {
    let field = field.into();
    validate_runtime_schema(schema, &field)?;
    if schema.get("type") != Some(&Value::String("object".to_owned())) {
        return Err(invalid(ValidationCode::InvalidSchema, field));
    }
    Ok(())
}

pub(super) fn validate_output_schema(
    schema: &serde_json::Map<String, Value>,
    field: impl Into<String>,
) -> Result<(), ValidationError> {
    validate_runtime_schema(schema, &field.into())
}

fn validate_runtime_schema(
    schema: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<(), ValidationError> {
    let mut nodes = 0;
    visit_runtime_schema(schema, field, 0, &mut nodes)
}

fn visit_runtime_schema(
    schema: &serde_json::Map<String, Value>,
    field: &str,
    depth: usize,
    nodes: &mut usize,
) -> Result<(), ValidationError> {
    *nodes += 1;
    if depth > super::MAX_SCHEMA_DEPTH || *nodes > super::MAX_SCHEMA_NODES {
        return Err(invalid(ValidationCode::LimitExceeded, field));
    }
    validate_object_limit(schema.len(), field)?;
    for key in schema.keys() {
        if !RUNTIME_SCHEMA_KEYWORDS.contains(&key.as_str()) {
            return Err(invalid(
                ValidationCode::InvalidSchema,
                format!("{field}.{key}"),
            ));
        }
    }
    if let Some(kind) = schema.get("type")
        && !kind.as_str().is_some_and(|kind| JSON_TYPES.contains(&kind))
    {
        return Err(invalid(
            ValidationCode::InvalidSchema,
            format!("{field}.type"),
        ));
    }
    // Depth counts JSON nesting, the same unit the routing compiler bounds, so
    // a schema this validator accepts always compiles: a property subschema
    // sits two levels down (`properties` → name), `items` and a schema-valued
    // `additionalProperties` one.
    if let Some(properties) = schema.get("properties") {
        let properties_field = format!("{field}.properties");
        let Value::Object(properties) = properties else {
            return Err(invalid(ValidationCode::InvalidSchema, properties_field));
        };
        for (name, candidate) in properties {
            let property_field = format!("{properties_field}.{name}");
            visit_subschema(candidate, &property_field, depth + 2, nodes)?;
        }
    }
    if let Some(items) = schema.get("items") {
        visit_subschema(items, &format!("{field}.items"), depth + 1, nodes)?;
    }
    if let Some(additional) = schema.get("additionalProperties")
        && !additional.is_boolean()
    {
        visit_subschema(
            additional,
            &format!("{field}.additionalProperties"),
            depth + 1,
            nodes,
        )?;
    }
    Ok(())
}

fn visit_subschema(
    candidate: &Value,
    field: &str,
    depth: usize,
    nodes: &mut usize,
) -> Result<(), ValidationError> {
    let Value::Object(schema) = candidate else {
        return Err(invalid(ValidationCode::InvalidSchema, field));
    };
    visit_runtime_schema(schema, field, depth, nodes)
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
    use serde_json::{Value, json};

    use super::{validate_input_schema, validate_output_schema, validate_tool_name};
    use crate::protocol::{ValidationCode, valid_identifier};

    fn object(value: Value) -> serde_json::Map<String, Value> {
        value.as_object().expect("schema must be an object").clone()
    }

    #[test]
    fn runtime_schemas_accept_the_interpreter_subset() {
        let schema = object(json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["rows"],
            "properties": {
                "rows": {
                    "type": "array",
                    "maxItems": 8,
                    "items": {
                        "type": "object",
                        "additionalProperties": { "type": "number", "minimum": 0 },
                        "properties": { "label": { "type": "string", "maxLength": 64 } }
                    }
                },
                "mode": { "enum": ["fast", "slow"] },
                "status": { "const": "ready" }
            }
        }));
        assert!(validate_input_schema(&schema, "input").is_ok());
        assert!(validate_output_schema(&schema, "output").is_ok());
        assert!(validate_output_schema(&object(json!({})), "output").is_ok());
    }

    #[test]
    fn runtime_schemas_reject_unsupported_keywords_at_their_exact_path() {
        for (schema, field) in [
            (
                json!({"type": "object", "properties": {"q": {"type": "string", "pattern": "^a"}}}),
                "input.properties.q.pattern",
            ),
            (
                json!({"type": "object", "$ref": "https://attacker.example/schema.json"}),
                "input.$ref",
            ),
            (
                json!({"type": "object", "properties": {"q": {"type": "string", "format": "regex"}}}),
                "input.properties.q.format",
            ),
            (
                json!({"type": "object", "items": {"type": "string", "pattern": ".*"}}),
                "input.items.pattern",
            ),
            (
                json!({"type": "object", "additionalProperties": {"anyOf": []}}),
                "input.additionalProperties.anyOf",
            ),
            (
                json!({"type": "object", "properties": {"q": {"type": ["string", "null"]}}}),
                "input.properties.q.type",
            ),
            (
                json!({"type": "object", "properties": {"q": "string"}}),
                "input.properties.q",
            ),
            (
                json!({"type": "object", "properties": []}),
                "input.properties",
            ),
        ] {
            let error = validate_input_schema(&object(schema), "input")
                .expect_err("unsupported schema must be rejected");
            assert_eq!(error.code, ValidationCode::InvalidSchema);
            assert_eq!(error.field, field);
        }
    }

    #[test]
    fn input_schemas_must_describe_an_object_root() {
        let error = validate_input_schema(&object(json!({"type": "string"})), "input")
            .expect_err("string root must fail");
        assert_eq!(error.code, ValidationCode::InvalidSchema);
        assert_eq!(error.field, "input");
    }

    #[test]
    fn runtime_schemas_are_depth_bounded() {
        let mut nested = json!({"type": "string"});
        for _ in 0..40 {
            nested = json!({"type": "object", "properties": {"next": nested}});
        }
        let error =
            validate_output_schema(&object(nested), "output").expect_err("deep schema must fail");
        assert_eq!(error.code, ValidationCode::LimitExceeded);
    }

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
