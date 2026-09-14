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
    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .should_validate_formats(true)
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
