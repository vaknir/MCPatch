use std::{collections::BTreeMap, sync::Arc};

use super::{
    PermissionDecision, RegistryError, RegistryErrorCode, RoutedCancellation,
    approval_limits::ApprovalLimiter,
    policy::permission_decision,
    schema::SchemaCache,
    snapshot_limits::SnapshotLimiter,
    state::{ConnectionState, ContextState, RegisteredCapability, ResolvedCapability},
    types::{ActiveRequest, PendingApproval},
};
use crate::{
    browser::{BrowserConnection, BrowserConnectionId},
    protocol::{Cancel, Capability, PROTOCOL_VERSION},
};

const MAX_CONNECTIONS: usize = 8;

pub struct CapabilityRegistry {
    pub(super) connections: BTreeMap<BrowserConnectionId, ConnectionState>,
    pub(super) active_requests: BTreeMap<String, ActiveRequest>,
    pub(super) pending_approvals: BTreeMap<String, PendingApproval>,
    pub(super) approval_limiter: ApprovalLimiter,
    pub(super) snapshot_limiter: SnapshotLimiter,
    pub(super) schema_cache: SchemaCache,
}

impl CapabilityRegistry {
    pub fn new() -> Self {
        Self {
            connections: BTreeMap::new(),
            active_requests: BTreeMap::new(),
            pending_approvals: BTreeMap::new(),
            approval_limiter: ApprovalLimiter::default(),
            snapshot_limiter: SnapshotLimiter::default(),
            schema_cache: SchemaCache::default(),
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
        self.approval_limiter.forget_connection(connection_id);
        self.snapshot_limiter.forget_connection(connection_id);

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
        let approval_ids = self
            .pending_approvals
            .iter()
            .filter(|(_, approval)| &approval.binding.connection_id == connection_id)
            .map(|(approval_id, _)| approval_id.clone())
            .collect::<Vec<_>>();
        for approval_id in approval_ids {
            if let Some(approval) = self.pending_approvals.remove(&approval_id) {
                approval.revocation.cancel();
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
                resolved = Some(resolve_registration(state, context, capability));
            }
        }
        resolved.ok_or_else(|| RegistryError::new(RegistryErrorCode::ToolNotFound))
    }

    /// Resolve the exact registration an approval was bound to. Unlike name
    /// resolution this ignores same-named tools that appeared in other contexts
    /// or connections while the human was deciding: the decision was made about
    /// one document, so it dispatches there or nowhere.
    pub(super) fn resolve_bound_capability(
        &self,
        connection_id: &BrowserConnectionId,
        context_id: &str,
        tool: &str,
    ) -> Option<ResolvedCapability> {
        let state = self.connections.get(connection_id)?;
        let context = state.contexts.get(context_id)?;
        let capability = context.capabilities.get(tool)?;
        Some(resolve_registration(state, context, capability))
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

        let mut cancellations = request_ids
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
            .collect::<Vec<_>>();
        let approval_ids = self
            .pending_approvals
            .iter()
            .filter(|(_, approval)| {
                &approval.binding.connection_id == connection_id
                    && approval.binding.context_id == context_id
            })
            .map(|(approval_id, _)| approval_id.clone())
            .collect::<Vec<_>>();
        cancellations.extend(approval_ids.into_iter().filter_map(|approval_id| {
            let approval = self.pending_approvals.remove(&approval_id)?;
            approval.revocation.cancel();
            Some(RoutedCancellation::new(
                connection.clone(),
                Cancel {
                    protocol_version: PROTOCOL_VERSION,
                    request_id: approval.binding.invocation.request_id,
                },
            ))
        }));
        cancellations
    }
}

impl Default for CapabilityRegistry {
    fn default() -> Self {
        Self::new()
    }
}

fn resolve_registration(
    state: &ConnectionState,
    context: &ContextState,
    capability: &RegisteredCapability,
) -> ResolvedCapability {
    ResolvedCapability {
        connection: state.connection.clone(),
        context_id: context.snapshot.context_id.clone(),
        context_revision: context.snapshot.context_revision,
        origin: context.snapshot.origin.clone(),
        capability: capability.capability.clone(),
        input_validator: capability.input_validator.clone(),
        output_validator: capability.output_validator.clone(),
    }
}
