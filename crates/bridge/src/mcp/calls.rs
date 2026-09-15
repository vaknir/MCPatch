use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use rmcp::{
    ErrorData as McpError,
    model::{CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock},
};
use serde_json::json;
use tokio_util::sync::CancellationToken;

use crate::routing::{
    BrowserToolResponse, RegistryError, RegistryErrorCode, RoutedCallCompletionError,
    SharedCapabilityRegistry, ToolInvocation,
};

const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub(super) struct McpCallRuntime {
    call_timeout: Duration,
    registry: SharedCapabilityRegistry,
    sequence: Arc<AtomicU64>,
}

impl McpCallRuntime {
    pub(super) fn new(registry: SharedCapabilityRegistry) -> Self {
        Self::with_timeout(registry, DEFAULT_CALL_TIMEOUT)
    }

    fn with_timeout(registry: SharedCapabilityRegistry, call_timeout: Duration) -> Self {
        Self {
            call_timeout,
            registry,
            sequence: Arc::new(AtomicU64::new(0)),
        }
    }

    pub(super) async fn execute(
        &self,
        request: CallToolRequestParams,
        cancellation: CancellationToken,
    ) -> Result<CallToolResponse, McpError> {
        if request.input_responses.is_some() || request.request_state.is_some() {
            return Err(McpError::invalid_params(
                "MCPatch does not accept tool-call continuation state",
                None,
            ));
        }
        if cancellation.is_cancelled() {
            return Ok(tool_failure("The MCPatch tool call was cancelled."));
        }

        let request_id = self.next_request_id();
        let invocation = ToolInvocation {
            request_id: request_id.clone(),
            tool: request.name.into_owned(),
            arguments: request.arguments.unwrap_or_default(),
        };
        let routed = match self.registry.lock().await.route_call(invocation) {
            Ok(routed) => routed,
            Err(error) => return map_route_error(error),
        };

        let dispatch_result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                self.cancel_pending(&request_id).await;
                return Ok(tool_failure("The MCPatch tool call was cancelled."));
            }
            result = routed.dispatch() => result,
        };
        if dispatch_result.is_err() {
            self.cancel_pending(&request_id).await;
            return Ok(tool_failure("The browser capability is unavailable."));
        }

        let completion = routed.completion();
        tokio::pin!(completion);
        let timeout = tokio::time::sleep(self.call_timeout);
        tokio::pin!(timeout);
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                self.cancel_pending(&request_id).await;
                Ok(tool_failure("The MCPatch tool call was cancelled."))
            }
            _ = &mut timeout => {
                self.cancel_pending(&request_id).await;
                Ok(tool_failure("The browser capability timed out."))
            }
            result = &mut completion => Ok(map_completion(result)),
        }
    }

    fn next_request_id(&self) -> String {
        let sequence = self
            .sequence
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        format!("mcp.{sequence:016x}")
    }

    async fn cancel_pending(&self, request_id: &str) {
        let cancellation = self.registry.lock().await.cancel_request(request_id);
        if let Some(cancellation) = cancellation {
            let _ = cancellation.dispatch().await;
        }
    }
}

fn map_route_error(error: RegistryError) -> Result<CallToolResponse, McpError> {
    match error.code() {
        RegistryErrorCode::InvalidArguments => Err(McpError::invalid_params(
            "Tool arguments failed schema validation",
            None,
        )),
        RegistryErrorCode::AmbiguousTool
        | RegistryErrorCode::CapabilityDenied
        | RegistryErrorCode::ToolNotFound => {
            Err(McpError::invalid_params("Tool is unavailable", None))
        }
        RegistryErrorCode::ApprovalRequired => Ok(tool_failure(
            "This capability requires an approval runtime that is not available.",
        )),
        _ => Err(McpError::internal_error(
            "MCPatch could not reserve the tool call",
            None,
        )),
    }
}

fn map_completion(
    completion: Result<BrowserToolResponse, RoutedCallCompletionError>,
) -> CallToolResponse {
    match completion {
        Ok(BrowserToolResponse::Result(result)) => CallToolResult::structured(result.result).into(),
        Ok(BrowserToolResponse::Error(error)) => CallToolResult::structured_error(json!({
            "code": error.code,
            "message": error.message,
            "retryable": error.retryable,
        }))
        .into(),
        Err(RoutedCallCompletionError::ResultInvalid) => {
            tool_failure("The browser capability returned an invalid result.")
        }
        Err(RoutedCallCompletionError::Revoked) => {
            tool_failure("The browser capability became unavailable.")
        }
    }
}

fn tool_failure(message: &'static str) -> CallToolResponse {
    CallToolResult::error(vec![ContentBlock::text(message)]).into()
}

#[cfg(test)]
mod tests;
