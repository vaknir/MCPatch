use std::collections::{BTreeMap, btree_map::Entry};

use jsonschema::{Draft, Validator};
use serde_json::Value;

use super::{RegistryError, RegistryErrorCode, state::RegisteredCapability};
use crate::protocol::Capability;

const MAX_SCHEMA_DEPTH: usize = 32;
const MAX_SCHEMA_NODES: usize = 4096;

pub(super) fn compile_capabilities(
    capabilities: &[Capability],
) -> Result<BTreeMap<String, RegisteredCapability>, RegistryError> {
    let mut compiled = BTreeMap::new();
    for capability in capabilities {
        let input_validator = compile_schema(&capability.input_schema)?;
        let output_validator = capability
            .output_schema
            .as_ref()
            .map(compile_schema)
            .transpose()?;
        match compiled.entry(capability.name.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(RegisteredCapability {
                    capability: capability.clone(),
                    input_validator,
                    output_validator,
                });
            }
            Entry::Occupied(_) => {
                return Err(RegistryError::new(RegistryErrorCode::InvalidMessage));
            }
        }
    }
    Ok(compiled)
}

fn compile_schema(schema: &serde_json::Map<String, Value>) -> Result<Validator, RegistryError> {
    let schema = Value::Object(schema.clone());
    if !schema_within_limits(&schema) {
        return Err(RegistryError::new(RegistryErrorCode::InvalidSchema));
    }
    // No allowlisted keyword needs format assertions, so leave them off: a
    // `format` that slipped past protocol validation must never compile the
    // instance value as a regex or otherwise interpret it.
    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .should_validate_formats(false)
        .build(&schema)
        .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidSchema))
}

fn schema_within_limits(schema: &Value) -> bool {
    let mut stack = vec![(schema, 1_usize)];
    let mut nodes = 0_usize;
    while let Some((value, depth)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_SCHEMA_NODES || depth > MAX_SCHEMA_DEPTH {
            return false;
        }
        match value {
            Value::Array(values) => {
                stack.extend(values.iter().map(|value| (value, depth + 1)));
            }
            Value::Object(values) => {
                stack.extend(values.values().map(|value| (value, depth + 1)));
            }
            _ => {}
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::compile_schema;

    fn object(value: Value) -> serde_json::Map<String, Value> {
        value.as_object().expect("schema must be an object").clone()
    }

    #[test]
    fn compiled_validators_never_assert_formats() {
        let validator = compile_schema(&object(json!({
            "type": "object",
            "properties": {"q": {"type": "string", "format": "regex"}}
        })))
        .expect("schema must compile");
        assert!(validator.is_valid(&json!({"q": "(((("})));
    }

    #[test]
    fn schemas_within_the_protocol_depth_bound_compile() {
        // Each `properties` level costs two JSON levels; protocol validation
        // counts the same units, so anything it accepts must compile here.
        let mut nested = json!({"type": "string"});
        for _ in 0..14 {
            nested = json!({"type": "object", "properties": {"next": nested}});
        }
        assert!(compile_schema(&object(nested)).is_ok());
    }
}
