use super::{
    RegistryChange, RegistryError, RegistryErrorCode,
    registry::CapabilityRegistry,
    schema::compile_capabilities,
    state::{ConnectionState, ContextState},
};
use crate::{
    browser::BrowserConnectionId,
    protocol::{CapabilitySnapshot, ContextClosed, Message, ValidationCode},
};

const MAX_CONTEXTS_PER_CONNECTION: usize = 64;
const MAX_CONTEXT_IDENTITIES_PER_CONNECTION: usize = 128;
const MAX_CAPABILITIES_PER_CONNECTION: usize = 1024;

impl CapabilityRegistry {
    pub fn replace_snapshot(
        &mut self,
        connection_id: &BrowserConnectionId,
        snapshot: CapabilitySnapshot,
    ) -> Result<RegistryChange, RegistryError> {
        Message::CapabilitySnapshot(snapshot.clone())
            .validate()
            .map_err(map_snapshot_validation_error)?;

        let state = self
            .connections
            .get(connection_id)
            .ok_or_else(|| RegistryError::new(RegistryErrorCode::ConnectionNotFound))?;
        if let Some(revision) = state.revisions.get(&snapshot.context_id) {
            if snapshot.context_revision < *revision {
                return Err(RegistryError::new(RegistryErrorCode::StaleRevision));
            }
            if snapshot.context_revision == *revision {
                return match state.contexts.get(&snapshot.context_id) {
                    Some(context) if context.snapshot == snapshot => Ok(RegistryChange::default()),
                    _ => Err(RegistryError::new(RegistryErrorCode::RevisionConflict)),
                };
            }
        }
        enforce_connection_limits(state, &snapshot)?;

        let capabilities = compile_capabilities(&snapshot.capabilities)?;
        let cancellations = self.revoke_context_requests(connection_id, &snapshot.context_id);
        let state = self
            .connections
            .get_mut(connection_id)
            .expect("connection existence was checked before compilation");
        state
            .revisions
            .insert(snapshot.context_id.clone(), snapshot.context_revision);
        state.contexts.insert(
            snapshot.context_id.clone(),
            ContextState {
                snapshot,
                capabilities,
            },
        );

        Ok(RegistryChange {
            changed: true,
            cancellations,
        })
    }

    pub fn close_context(
        &mut self,
        connection_id: &BrowserConnectionId,
        closed: ContextClosed,
    ) -> Result<RegistryChange, RegistryError> {
        Message::ContextClosed(closed.clone())
            .validate()
            .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidMessage))?;

        let state = self
            .connections
            .get(connection_id)
            .ok_or_else(|| RegistryError::new(RegistryErrorCode::ConnectionNotFound))?;
        if !state.revisions.contains_key(&closed.context_id)
            && state.revisions.len() >= MAX_CONTEXT_IDENTITIES_PER_CONNECTION
        {
            return Err(RegistryError::new(RegistryErrorCode::LimitExceeded));
        }
        if let Some(revision) = state.revisions.get(&closed.context_id) {
            if closed.context_revision < *revision {
                return Err(RegistryError::new(RegistryErrorCode::StaleRevision));
            }
            if closed.context_revision == *revision
                && !state.contexts.contains_key(&closed.context_id)
            {
                return Ok(RegistryChange::default());
            }
        }

        let cancellations = self.revoke_context_requests(connection_id, &closed.context_id);
        let state = self
            .connections
            .get_mut(connection_id)
            .expect("connection existence was checked before cancellation");
        let changed = state.contexts.remove(&closed.context_id).is_some();
        state
            .revisions
            .insert(closed.context_id, closed.context_revision);
        Ok(RegistryChange {
            changed,
            cancellations,
        })
    }
}

fn enforce_connection_limits(
    state: &ConnectionState,
    snapshot: &CapabilitySnapshot,
) -> Result<(), RegistryError> {
    if !state.contexts.contains_key(&snapshot.context_id)
        && state.contexts.len() >= MAX_CONTEXTS_PER_CONNECTION
    {
        return Err(RegistryError::new(RegistryErrorCode::LimitExceeded));
    }
    if !state.revisions.contains_key(&snapshot.context_id)
        && state.revisions.len() >= MAX_CONTEXT_IDENTITIES_PER_CONNECTION
    {
        return Err(RegistryError::new(RegistryErrorCode::LimitExceeded));
    }
    let current_capabilities = state
        .contexts
        .get(&snapshot.context_id)
        .map_or(0, |context| context.capabilities.len());
    let total_capabilities = state
        .contexts
        .values()
        .map(|context| context.capabilities.len())
        .sum::<usize>()
        - current_capabilities
        + snapshot.capabilities.len();
    if total_capabilities > MAX_CAPABILITIES_PER_CONNECTION {
        return Err(RegistryError::new(RegistryErrorCode::LimitExceeded));
    }
    Ok(())
}

fn map_snapshot_validation_error(error: crate::protocol::ValidationError) -> RegistryError {
    if error.code == ValidationCode::InvalidCapability && error.field.ends_with(".origin") {
        RegistryError::new(RegistryErrorCode::OriginMismatch)
    } else {
        RegistryError::new(RegistryErrorCode::InvalidMessage)
    }
}
