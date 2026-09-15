use serde_json::Value;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::{
    BrowserToolResponse, PermissionDecision, RegistryError, RegistryErrorCode, RoutedCall,
    RoutedCancellation, ToolInvocation, permission_decision,
    registry::CapabilityRegistry,
    types::{ActiveRequest, RoutedCallCompletionError},
};
use crate::{
    browser::BrowserConnectionId,
    protocol::{Cancel, Message, PROTOCOL_VERSION, ToolCall},
};

const MAX_IN_FLIGHT_REQUESTS: usize = 128;

impl CapabilityRegistry {
    pub fn route_call(&mut self, invocation: ToolInvocation) -> Result<RoutedCall, RegistryError> {
        validate_request_id(&invocation.request_id)?;
        if self.active_requests.contains_key(&invocation.request_id) {
            return Err(RegistryError::new(RegistryErrorCode::DuplicateRequest));
        }
        if self.active_requests.len() >= MAX_IN_FLIGHT_REQUESTS {
            return Err(RegistryError::new(RegistryErrorCode::LimitExceeded));
        }

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
        let request = self.active_requests.remove(request_id)?;
        request.revocation.cancel();
        let connection = self
            .connections
            .get(&request.connection_id)?
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
