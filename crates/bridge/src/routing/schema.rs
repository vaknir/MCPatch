use std::{
    collections::{BTreeMap, btree_map::Entry},
    sync::Arc,
};

use jsonschema::{Draft, Validator};
use serde_json::Value;

use super::{RegistryError, RegistryErrorCode, state::RegisteredCapability};
use crate::protocol::Capability;

const MAX_SCHEMA_DEPTH: usize = 32;
const MAX_SCHEMA_NODES: usize = 4096;
/// Distinct schemas kept compiled. Real pages republish the same schemas on
/// every snapshot, so this makes a re-registration cost nothing; the cache is
/// cleared, not evicted, when full so it stays a bounded, predictable map.
const MAX_CACHED_VALIDATORS: usize = 256;

/// Compiled validators shared across snapshots by exact schema bytes.
#[derive(Debug, Default)]
pub(super) struct SchemaCache {
    validators: BTreeMap<Vec<u8>, Arc<Validator>>,
}

impl SchemaCache {
    fn compile(
        &mut self,
        schema: &serde_json::Map<String, Value>,
    ) -> Result<Arc<Validator>, RegistryError> {
        // `serde_json::Map` keeps keys sorted, so equal schemas serialize to
        // equal bytes and the bytes are a canonical key.
        let key = serde_json::to_vec(&Value::Object(schema.clone()))
            .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidSchema))?;
        if let Some(validator) = self.validators.get(&key) {
            return Ok(validator.clone());
        }
        let validator = Arc::new(compile_schema(schema)?);
        if self.validators.len() >= MAX_CACHED_VALIDATORS {
            self.validators.clear();
        }
        self.validators.insert(key, validator.clone());
        Ok(validator)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.validators.len()
    }
}

pub(super) fn compile_capabilities(
    cache: &mut SchemaCache,
    capabilities: &[Capability],
) -> Result<BTreeMap<String, RegisteredCapability>, RegistryError> {
    let mut compiled = BTreeMap::new();
    for capability in capabilities {
        let input_validator = cache.compile(&capability.input_schema)?;
        let output_validator = capability
            .output_schema
            .as_ref()
            .map(|schema| cache.compile(schema))
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
    fn identical_schemas_share_one_compiled_validator() {
        let mut cache = super::SchemaCache::default();
        let schema = object(json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {"q": {"type": "string", "maxLength": 8}}
        }));
        let first = cache.compile(&schema).expect("schema must compile");
        let second = cache.compile(&schema).expect("schema must compile");
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        assert_eq!(cache.len(), 1);

        let different = object(json!({"type": "object", "additionalProperties": false}));
        let third = cache.compile(&different).expect("schema must compile");
        assert!(!std::sync::Arc::ptr_eq(&first, &third));
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn the_validator_cache_stays_bounded() {
        let mut cache = super::SchemaCache::default();
        for index in 0..(super::MAX_CACHED_VALIDATORS + 1) {
            let schema = object(json!({"type": "object", "maxProperties": index}));
            cache.compile(&schema).expect("schema must compile");
        }
        assert!(cache.len() <= super::MAX_CACHED_VALIDATORS);
        assert!(cache.len() >= 1);
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
