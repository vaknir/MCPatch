use std::{
    ffi::OsStr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use futures_util::future::BoxFuture;
use rmcp::{
    ErrorData as McpError,
    model::{CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock},
};
use serde_json::json;
use time::OffsetDateTime;
use tokio_util::sync::CancellationToken;

use crate::protocol::{ApprovalRequester, ToolContent};
use crate::routing::{
    ApprovalCompletionError, ApprovalGrant, BrowserToolResponse, CallReservation, RegistryError,
    RegistryErrorCode, RoutedCall, RoutedCallCompletionError, SharedCapabilityRegistry,
    ToolInvocation,
};

const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_APPROVAL_TIMEOUT: Duration = Duration::from_secs(60);
/// Environment override for the approval wait; see `approval_timeout_from`.
pub(super) const APPROVAL_TIMEOUT_ENV: &str = "MCPATCH_APPROVAL_TIMEOUT_SECS";
const MIN_APPROVAL_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_APPROVAL_TIMEOUT: Duration = Duration::from_secs(300);
/// How often the client hears that the call is still waiting on a human.
const APPROVAL_PROGRESS_INTERVAL: Duration = Duration::from_secs(10);
/// Fixed progress text: it names no tool, origin, or argument, so a progress
/// notification can never leak what the prompt is about.
pub(super) const APPROVAL_WAIT_MESSAGE: &str =
    "Waiting for the user to decide in the MCPatch browser prompt.";

/// Shown when a client's declared name is absent, empty, too long, or not
/// printable ASCII; the label is display-only and never policy.
pub(super) const UNKNOWN_CLIENT_LABEL: &str = "unknown client";

/// Build the display-only requester label from the client's own `initialize`
/// name and the bridge-assigned session label. The name is untrusted client
/// input rendered in the trusted prompt, so anything that is not short
/// printable ASCII is replaced rather than escaped.
pub(super) fn requester_label(client_name: Option<&str>, session: &str) -> ApprovalRequester {
    let client = client_name
        .map(str::trim)
        .filter(|name| crate::protocol::valid_display_label(name))
        .unwrap_or(UNKNOWN_CLIENT_LABEL);
    ApprovalRequester {
        client: client.to_owned(),
        session: session.to_owned(),
    }
}

/// Sends bounded progress to the MCP client while a call waits on a human.
/// Implemented over the rmcp peer in production and by a recorder in tests.
pub(super) trait ApprovalProgress: Send + Sync {
    fn report(&self, sequence: u32) -> BoxFuture<'_, ()>;
}

pub(super) type SharedApprovalProgress = Arc<dyn ApprovalProgress>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ApprovalTimeoutError {
    Unparseable,
    OutOfRange,
}

impl ApprovalTimeoutError {
    pub(super) const fn code(self) -> &'static str {
        match self {
            Self::Unparseable => "approval_timeout_unparseable",
            Self::OutOfRange => "approval_timeout_out_of_range",
        }
    }
}

/// Resolve the approval wait from `MCPATCH_APPROVAL_TIMEOUT_SECS`. Absent means
/// the default; anything unparseable or outside 5–300 seconds is an error the
/// caller logs before falling back, so a typo never silently disables prompts.
pub(super) fn approval_timeout_from(
    value: Option<&OsStr>,
) -> Result<Duration, ApprovalTimeoutError> {
    let Some(value) = value else {
        return Ok(DEFAULT_APPROVAL_TIMEOUT);
    };
    let seconds = value
        .to_str()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .ok_or(ApprovalTimeoutError::Unparseable)?;
    let timeout = Duration::from_secs(seconds);
    if timeout < MIN_APPROVAL_TIMEOUT || timeout > MAX_APPROVAL_TIMEOUT {
        return Err(ApprovalTimeoutError::OutOfRange);
    }
    Ok(timeout)
}

#[derive(Clone)]
pub(super) struct McpCallRuntime {
    approval_timeout: Duration,
    call_timeout: Duration,
    registry: SharedCapabilityRegistry,
    sequence: Arc<AtomicU64>,
}

impl McpCallRuntime {
    pub(super) fn new(registry: SharedCapabilityRegistry) -> Self {
        Self::with_timeout(registry, DEFAULT_CALL_TIMEOUT)
    }

    pub(super) fn with_approval_timeout(
        registry: SharedCapabilityRegistry,
        approval_timeout: Duration,
    ) -> Self {
        Self::with_timeouts(registry, DEFAULT_CALL_TIMEOUT, approval_timeout)
    }

    fn with_timeout(registry: SharedCapabilityRegistry, call_timeout: Duration) -> Self {
        Self::with_timeouts(registry, call_timeout, DEFAULT_APPROVAL_TIMEOUT)
    }

    fn with_timeouts(
        registry: SharedCapabilityRegistry,
        call_timeout: Duration,
        approval_timeout: Duration,
    ) -> Self {
        Self {
            approval_timeout,
            call_timeout,
            registry,
            sequence: Arc::new(AtomicU64::new(0)),
        }
    }

    pub(super) async fn execute(
        &self,
        request: CallToolRequestParams,
        cancellation: CancellationToken,
        progress: Option<SharedApprovalProgress>,
        requester: ApprovalRequester,
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
        let reservation = match self.registry.lock().await.prepare_call(
            invocation,
            OffsetDateTime::now_utc(),
            self.approval_timeout,
            requester,
        ) {
            Ok(reservation) => reservation,
            Err(error) => return map_route_error(error),
        };
        let routed = match reservation {
            CallReservation::Call(routed) => routed,
            CallReservation::Approval(approval) => {
                let grant = match self
                    .await_approval(approval, &request_id, &cancellation, progress)
                    .await
                {
                    Ok(grant) => grant,
                    Err(error) => return Ok(tool_failure(error.message())),
                };
                match self
                    .registry
                    .lock()
                    .await
                    .route_approved(grant, OffsetDateTime::now_utc())
                {
                    Ok(routed) => routed,
                    Err(error) => {
                        return Ok(tool_failure(approval_route_failure(error.code())));
                    }
                }
            }
        };

        self.execute_routed(routed, &request_id, cancellation).await
    }

    async fn await_approval(
        &self,
        approval: crate::routing::RoutedApproval,
        request_id: &str,
        cancellation: &CancellationToken,
        progress: Option<SharedApprovalProgress>,
    ) -> Result<ApprovalGrant, ApprovalWaitError> {
        let dispatch_result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                self.cancel_pending(request_id).await;
                return Err(ApprovalWaitError::Cancelled);
            }
            result = approval.dispatch() => result,
        };
        if dispatch_result.is_err() {
            self.cancel_pending(request_id).await;
            return Err(ApprovalWaitError::Unavailable);
        }

        // The prompt is on screen. Tell the client once now and then on every
        // interval, so it can distinguish a human deciding from a hung server.
        let mut sequence = 0_u32;
        if let Some(progress) = &progress {
            sequence += 1;
            progress.report(sequence).await;
        }
        let mut ticks = tokio::time::interval(APPROVAL_PROGRESS_INTERVAL);
        ticks.tick().await;

        let completion = approval.completion();
        tokio::pin!(completion);
        let timeout = tokio::time::sleep(self.approval_timeout);
        tokio::pin!(timeout);
        loop {
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => {
                    self.cancel_pending(request_id).await;
                    return Err(ApprovalWaitError::Cancelled);
                }
                _ = &mut timeout => {
                    self.cancel_pending(request_id).await;
                    return Err(ApprovalWaitError::Expired);
                }
                result = &mut completion => {
                    return match result {
                        Ok(grant) => Ok(grant),
                        Err(ApprovalCompletionError::Denied) => Err(ApprovalWaitError::Denied),
                        Err(ApprovalCompletionError::Expired) => Err(ApprovalWaitError::Expired),
                        Err(ApprovalCompletionError::Revoked) => Err(ApprovalWaitError::Revoked),
                    };
                }
                _ = ticks.tick() => {
                    if let Some(progress) = &progress {
                        sequence = sequence.saturating_add(1);
                        progress.report(sequence).await;
                    }
                }
            }
        }
    }

    async fn execute_routed(
        &self,
        routed: RoutedCall,
        request_id: &str,
        cancellation: CancellationToken,
    ) -> Result<CallToolResponse, McpError> {
        let dispatch_result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                self.cancel_pending(request_id).await;
                return Ok(tool_failure("The MCPatch tool call was cancelled."));
            }
            result = routed.dispatch() => result,
        };
        if dispatch_result.is_err() {
            self.cancel_pending(request_id).await;
            return Ok(tool_failure("The browser capability is unavailable."));
        }

        let completion = routed.completion();
        tokio::pin!(completion);
        let timeout = tokio::time::sleep(self.call_timeout);
        tokio::pin!(timeout);
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                self.cancel_pending(request_id).await;
                Ok(tool_failure("The MCPatch tool call was cancelled."))
            }
            _ = &mut timeout => {
                self.cancel_pending(request_id).await;
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ApprovalWaitError {
    Cancelled,
    Denied,
    Expired,
    Revoked,
    Unavailable,
}

impl ApprovalWaitError {
    const fn message(self) -> &'static str {
        match self {
            Self::Cancelled => "The MCPatch tool call was cancelled.",
            Self::Denied => "The user denied this tool call.",
            Self::Expired => "The approval request expired.",
            Self::Revoked => "The approval request was revoked.",
            Self::Unavailable => "The approval surface is unavailable.",
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
        RegistryErrorCode::ApprovalRateLimited => Ok(tool_failure(
            "Approval prompts for this site are rate limited. Wait before requesting another approval.",
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
        Ok(BrowserToolResponse::Result(result)) => {
            let mut response = CallToolResult::structured(result.result);
            response
                .content
                .extend(result.content.into_iter().map(|content| match content {
                    ToolContent::Image(image) => ContentBlock::image(image.data, image.mime_type),
                }));
            response.into()
        }
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

/// Tell the caller when a valid decision lost its target, so the model retries
/// with a fresh approval instead of concluding the human refused.
const fn approval_route_failure(code: RegistryErrorCode) -> &'static str {
    match code {
        RegistryErrorCode::ApprovalContextChanged => {
            "The approved page changed before the call could run. Call the tool again to request a fresh approval."
        }
        _ => "The approval is no longer valid.",
    }
}

#[cfg(test)]
mod tests;
