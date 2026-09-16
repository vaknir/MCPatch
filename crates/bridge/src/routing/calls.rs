use serde_json::Value;
use std::time::Duration;
use time::OffsetDateTime;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::{
    BrowserToolResponse, CallReservation, MAX_RESERVED_REQUESTS, PermissionDecision, RegistryError,
    RegistryErrorCode, RoutedCall, RoutedCancellation, ToolInvocation, permission_decision,
    registry::CapabilityRegistry,
    state::ResolvedCapability,
    types::{ActiveRequest, ApprovalGrant, RoutedCallCompletionError},
};
use crate::{
    browser::BrowserConnectionId,
    protocol::{ApprovalRequester, Cancel, Message, PROTOCOL_VERSION, ToolCall},
};

impl CapabilityRegistry {
    pub fn route_call(&mut self, invocation: ToolInvocation) -> Result<RoutedCall, RegistryError> {
        self.validate_reservation(&invocation)?;
        let resolved = self.resolve_capability(&invocation.tool)?;
        match permission_decision(&resolved.capability) {
            PermissionDecision::Allow => {}
            PermissionDecision::ApprovalRequired => {
                return Err(RegistryError::new(RegistryErrorCode::ApprovalRequired));
            }
            PermissionDecision::Deny => {
                return Err(RegistryError::new(RegistryErrorCode::CapabilityDenied));
            }
        }

        if !resolved
            .input_validator
            .is_valid(&Value::Object(invocation.arguments.clone()))
        {
            return Err(RegistryError::new(RegistryErrorCode::InvalidArguments));
        }

        self.reserve_call(invocation, resolved)
    }

    pub fn prepare_call(
        &mut self,
        invocation: ToolInvocation,
        now: OffsetDateTime,
        approval_ttl: Duration,
        requester: ApprovalRequester,
    ) -> Result<CallReservation, RegistryError> {
        self.purge_expired_approvals(now);
        self.validate_reservation(&invocation)?;
        let resolved = self.resolve_capability(&invocation.tool)?;
        match permission_decision(&resolved.capability) {
            PermissionDecision::Deny => {
                return Err(RegistryError::new(RegistryErrorCode::CapabilityDenied));
            }
            PermissionDecision::Allow | PermissionDecision::ApprovalRequired => {}
        }
        self.validate_arguments(&invocation, &resolved)?;

        if permission_decision(&resolved.capability) == PermissionDecision::ApprovalRequired {
            self.reserve_approval(invocation, resolved, now, approval_ttl, requester)
                .map(CallReservation::Approval)
        } else {
            self.reserve_call(invocation, resolved)
                .map(CallReservation::Call)
        }
    }

    pub fn route_approved(
        &mut self,
        grant: ApprovalGrant,
        now: OffsetDateTime,
    ) -> Result<RoutedCall, RegistryError> {
        let binding = grant.binding;
        if binding.protocol_version != PROTOCOL_VERSION
            || binding.policy_version != super::approvals::APPROVAL_POLICY_VERSION
        {
            return Err(RegistryError::new(RegistryErrorCode::ApprovalMismatch));
        }
        if now < binding.issued_at || now >= binding.expires_at {
            return Err(RegistryError::new(RegistryErrorCode::ApprovalExpired));
        }
        self.validate_reservation(&binding.invocation)?;
        // The human approved one exact document, so dispatch is bound to that
        // registration rather than re-resolved by name: a same-named tool that
        // appeared in another tab or profile meanwhile must neither hijack nor
        // block the approved call.
        let resolved = self
            .resolve_bound_capability(
                &binding.connection_id,
                &binding.context_id,
                &binding.invocation.tool,
            )
            .ok_or_else(|| RegistryError::new(RegistryErrorCode::ApprovalContextChanged))?;
        if resolved.context_revision != binding.context_revision {
            return Err(RegistryError::new(
                RegistryErrorCode::ApprovalContextChanged,
            ));
        }
        self.validate_arguments(&binding.invocation, &resolved)?;
        let current_hash =
            super::approvals::canonical_arguments_hash(&binding.invocation.arguments)?;
        if permission_decision(&resolved.capability) != PermissionDecision::ApprovalRequired
            || resolved.connection.id() != &binding.connection_id
            || resolved.context_id != binding.context_id
            || resolved.origin != binding.origin
            || resolved.capability != binding.capability
            || current_hash != binding.args_hash
        {
            return Err(RegistryError::new(RegistryErrorCode::ApprovalMismatch));
        }
        self.reserve_call(binding.invocation, resolved)
    }

    pub(super) fn validate_reservation(
        &self,
        invocation: &ToolInvocation,
    ) -> Result<(), RegistryError> {
        validate_request_id(&invocation.request_id)?;
        if self.active_requests.contains_key(&invocation.request_id)
            || self
                .pending_approvals
                .values()
                .any(|approval| approval.binding.invocation.request_id == invocation.request_id)
        {
            return Err(RegistryError::new(RegistryErrorCode::DuplicateRequest));
        }
        if self.active_requests.len() + self.pending_approvals.len() >= MAX_RESERVED_REQUESTS {
            return Err(RegistryError::new(RegistryErrorCode::LimitExceeded));
        }
        Ok(())
    }

    pub(super) fn validate_arguments(
        &self,
        invocation: &ToolInvocation,
        resolved: &ResolvedCapability,
    ) -> Result<(), RegistryError> {
        if resolved
            .input_validator
            .is_valid(&Value::Object(invocation.arguments.clone()))
        {
            Ok(())
        } else {
            Err(RegistryError::new(RegistryErrorCode::InvalidArguments))
        }
    }

    pub(super) fn reserve_call(
        &mut self,
        invocation: ToolInvocation,
        resolved: ResolvedCapability,
    ) -> Result<RoutedCall, RegistryError> {
        let message = ToolCall {
            protocol_version: PROTOCOL_VERSION,
            request_id: invocation.request_id.clone(),
            context_id: resolved.context_id.clone(),
            context_revision: resolved.context_revision,
            origin: resolved.origin.clone(),
            tool: invocation.tool,
            args: invocation.arguments,
        };
        Message::ToolCall(message.clone())
            .validate()
            .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidArguments))?;

        let revocation = CancellationToken::new();
        let (completion_sender, completion_receiver) = oneshot::channel();
        self.active_requests.insert(
            invocation.request_id,
            ActiveRequest {
                completion: completion_sender,
                connection_id: resolved.connection.id().clone(),
                context_id: resolved.context_id,
                context_revision: resolved.context_revision,
                origin: resolved.origin,
                output_validator: resolved.output_validator,
                revocation: revocation.clone(),
            },
        );

        Ok(RoutedCall::new(
            resolved.connection,
            completion_receiver,
            message,
            revocation,
        ))
    }

    pub fn cancel_request(&mut self, request_id: &str) -> Option<RoutedCancellation> {
        if let Some(request) = self.active_requests.remove(request_id) {
            request.revocation.cancel();
            let connection = self
                .connections
                .get(&request.connection_id)?
                .connection
                .clone();
            return Some(RoutedCancellation::new(
                connection,
                Cancel {
                    protocol_version: PROTOCOL_VERSION,
                    request_id: request_id.to_owned(),
                },
            ));
        }
        let approval_id = self
            .pending_approvals
            .iter()
            .find(|(_, approval)| approval.binding.invocation.request_id == request_id)
            .map(|(approval_id, _)| approval_id.clone())?;
        let approval = self.pending_approvals.remove(&approval_id)?;
        approval.revocation.cancel();
        let connection = self
            .connections
            .get(&approval.binding.connection_id)?
            .connection
            .clone();
        Some(RoutedCancellation::new(
            connection,
            Cancel {
                protocol_version: PROTOCOL_VERSION,
                request_id: request_id.to_owned(),
            },
        ))
    }

    pub fn accept_response(
        &mut self,
        connection_id: &BrowserConnectionId,
        response: BrowserToolResponse,
    ) -> Result<(), RegistryError> {
        validate_response(&response)?;
        let request_id = response.request_id().to_owned();
        let active = self
            .active_requests
            .get(&request_id)
            .ok_or_else(|| RegistryError::new(RegistryErrorCode::RequestNotFound))?;
        if &active.connection_id != connection_id {
            return Err(RegistryError::new(RegistryErrorCode::Unauthorized));
        }
        if active.origin != response.origin() {
            return Err(RegistryError::new(RegistryErrorCode::OriginMismatch));
        }
        if active.context_id != response.context_id()
            || active.context_revision != response.context_revision()
        {
            return Err(RegistryError::new(RegistryErrorCode::RouteMismatch));
        }

        if let (Some(validator), BrowserToolResponse::Result(result)) =
            (&active.output_validator, &response)
            && !validator.is_valid(&result.result)
        {
            let active = self
                .active_requests
                .remove(&request_id)
                .expect("validated active request must still exist");
            let _ = active
                .completion
                .send(Err(RoutedCallCompletionError::ResultInvalid));
            return Err(RegistryError::new(RegistryErrorCode::ResultInvalid));
        }

        let active = self
            .active_requests
            .remove(&request_id)
            .expect("validated active request must still exist");
        let _ = active.completion.send(Ok(response));
        Ok(())
    }
}

fn validate_request_id(request_id: &str) -> Result<(), RegistryError> {
    Message::Cancel(Cancel {
        protocol_version: PROTOCOL_VERSION,
        request_id: request_id.to_owned(),
    })
    .validate()
    .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidMessage))
}

fn validate_response(response: &BrowserToolResponse) -> Result<(), RegistryError> {
    let message = match response {
        BrowserToolResponse::Result(result) => Message::ToolResult(result.clone()),
        BrowserToolResponse::Error(error) => Message::ToolError(error.clone()),
    };
    message
        .validate()
        .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidMessage))
}
