use std::{collections::BTreeMap, sync::Arc};

use super::{
    PermissionDecision, RegistryError, RegistryErrorCode, RoutedCancellation,
    policy::permission_decision,
    state::{ConnectionState, RegisteredCapability, ResolvedCapability},
    types::ActiveRequest,
};
use crate::{
    browser::{BrowserConnection, BrowserConnectionId},
    protocol::{Cancel, Capability, PROTOCOL_VERSION},
};

const MAX_CONNECTIONS: usize = 8;

pub struct CapabilityRegistry {
    pub(super) connections: BTreeMap<BrowserConnectionId, ConnectionState>,
    pub(super) active_requests: BTreeMap<String, ActiveRequest>,
}

impl CapabilityRegistry {
    pub fn new() -> Self {
        Self {
            connections: BTreeMap::new(),
            active_requests: BTreeMap::new(),
        }
    }

    pub fn add_connection(
        &mut self,
        connection: Arc<dyn BrowserConnection>,
    ) -> Result<(), RegistryError> {
        if self.connections.contains_key(connection.id()) {
            return Err(RegistryError::new(
                RegistryErrorCode::ConnectionAlreadyExists,
            ));
        }
        if self.connections.len() >= MAX_CONNECTIONS {
            return Err(RegistryError::new(RegistryErrorCode::LimitExceeded));
        }

        self.connections.insert(
            connection.id().clone(),
            ConnectionState {
                connection,
                contexts: BTreeMap::new(),
                revisions: BTreeMap::new(),
            },
        );
        Ok(())
    }

    pub fn remove_connection(&mut self, connection_id: &BrowserConnectionId) -> bool {
        if self.connections.remove(connection_id).is_none() {
            return false;
        }

        let request_ids = self
            .active_requests
            .iter()
            .filter(|(_, request)| &request.connection_id == connection_id)
            .map(|(request_id, _)| request_id.clone())
            .collect::<Vec<_>>();
        for request_id in request_ids {
            if let Some(request) = self.active_requests.remove(&request_id) {
                request.revocation.cancel();
            }
        }
        true
    }

    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }

    pub fn visible_capabilities(&self) -> Vec<Capability> {
        let mut candidates: BTreeMap<&str, Vec<&RegisteredCapability>> = BTreeMap::new();
        for state in self.connections.values() {
            for context in state.contexts.values() {
                for capability in context.capabilities.values() {
                    candidates
                        .entry(&capability.capability.name)
                        .or_default()
                        .push(capability);
                }
            }
        }
        candidates
            .into_values()
            .filter_map(|candidates| match candidates.as_slice() {
                [candidate]
                    if permission_decision(&candidate.capability) != PermissionDecision::Deny =>
                {
                    Some(candidate.capability.clone())
                }
                _ => None,
            })
            .collect()
    }

    pub(super) fn resolve_capability(
        &self,
        tool: &str,
    ) -> Result<ResolvedCapability, RegistryError> {
        let mut resolved = None;
        for state in self.connections.values() {
            for context in state.contexts.values() {
                let Some(capability) = context.capabilities.get(tool) else {
                    continue;
                };
                if resolved.is_some() {
                    return Err(RegistryError::new(RegistryErrorCode::AmbiguousTool));
                }
                resolved = Some(ResolvedCapability {
                    connection: state.connection.clone(),
                    context_id: context.snapshot.context_id.clone(),
                    context_revision: context.snapshot.context_revision,
                    origin: context.snapshot.origin.clone(),
                    capability: capability.capability.clone(),
                    input_validator: capability.input_validator.clone(),
                    output_validator: capability.output_validator.clone(),
                });
            }
        }
        resolved.ok_or_else(|| RegistryError::new(RegistryErrorCode::ToolNotFound))
    }

    pub(super) fn revoke_context_requests(
        &mut self,
        connection_id: &BrowserConnectionId,
        context_id: &str,
    ) -> Vec<RoutedCancellation> {
        let Some(connection) = self
            .connections
            .get(connection_id)
            .map(|state| state.connection.clone())
        else {
            return Vec::new();
        };
        let request_ids = self
            .active_requests
            .iter()
            .filter(|(_, request)| {
                &request.connection_id == connection_id && request.context_id == context_id
            })
            .map(|(request_id, _)| request_id.clone())
            .collect::<Vec<_>>();

        request_ids
            .into_iter()
            .filter_map(|request_id| {
                let request = self.active_requests.remove(&request_id)?;
                request.revocation.cancel();
                Some(RoutedCancellation::new(
                    connection.clone(),
                    Cancel {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                    },
                ))
            })
            .collect()
    }
}

impl Default for CapabilityRegistry {
    fn default() -> Self {
        Self::new()
    }
}
