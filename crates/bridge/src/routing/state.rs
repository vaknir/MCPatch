use std::{collections::BTreeMap, sync::Arc};

use jsonschema::Validator;

use crate::{
    browser::BrowserConnection,
    protocol::{Capability, CapabilitySnapshot},
};

pub(super) struct ConnectionState {
    pub connection: Arc<dyn BrowserConnection>,
    pub contexts: BTreeMap<String, ContextState>,
    pub revisions: BTreeMap<String, u64>,
}

pub(super) struct ContextState {
    pub snapshot: CapabilitySnapshot,
    pub capabilities: BTreeMap<String, RegisteredCapability>,
}

pub(super) struct RegisteredCapability {
    pub capability: Capability,
    pub input_validator: Validator,
    pub output_validator: Option<Validator>,
}

pub(super) struct ResolvedCapability {
    pub connection: Arc<dyn BrowserConnection>,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub capability: Capability,
    pub input_validator: Validator,
    pub output_validator: Option<Validator>,
}
