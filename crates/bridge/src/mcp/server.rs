use std::{borrow::Cow, fmt, sync::Arc};

use futures_util::future::BoxFuture;
use rmcp::{
    ErrorData as McpError, Peer, RoleServer, ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, Implementation, ListToolsResult,
        PaginatedRequestParams, ProgressNotification, ProgressNotificationParam, ProgressToken,
        ProtocolVersion, ServerCapabilities, ServerInfo, ServerNotification, Tool, ToolAnnotations,
    },
    service::RequestContext,
};

use crate::{
    PRODUCT_VERSION,
    protocol::{Capability, Risk},
    routing::{SharedCapabilityRegistry, shared_capability_registry},
};

use super::calls::{
    APPROVAL_TIMEOUT_ENV, APPROVAL_WAIT_MESSAGE, ApprovalProgress, McpCallRuntime,
    approval_timeout_from, requester_label,
};

const SUPPORTED_MCP_VERSIONS: &[ProtocolVersion] =
    &[ProtocolVersion::V_2025_11_25, ProtocolVersion::V_2026_07_28];

/// Core-owned MCP handler sharing the browser capability registry.
#[derive(Clone)]
pub struct BridgeMcpServer {
    calls: McpCallRuntime,
    registry: SharedCapabilityRegistry,
    /// Short bridge-assigned label for this MCP session, shown in approval
    /// prompts so a user with several clients can tell which one is asking.
    session: Arc<str>,
}

impl BridgeMcpServer {
    /// Derive the handler for one accepted MCP session. Every session shares
    /// the registry and call runtime; only the display label differs.
    pub fn for_session(&self, sequence: u64) -> Self {
        Self {
            calls: self.calls.clone(),
            registry: self.registry.clone(),
            session: Arc::from(format!("session-{sequence:04x}")),
        }
    }

    /// The label this handler attaches to approval prompts as the requester
    /// session.
    pub fn session_label(&self) -> &str {
        &self.session
    }

    pub fn new(registry: SharedCapabilityRegistry) -> Self {
        let approval_timeout = match approval_timeout_from(
            std::env::var_os(APPROVAL_TIMEOUT_ENV).as_deref(),
        ) {
            Ok(timeout) => Some(timeout),
            Err(error) => {
                tracing::warn!(target: "mcpatch", event = "approval_timeout_ignored", code = error.code());
                None
            }
        };
        let calls = match approval_timeout {
            Some(timeout) => McpCallRuntime::with_approval_timeout(registry.clone(), timeout),
            None => McpCallRuntime::new(registry.clone()),
        };
        Self {
            calls,
            registry,
            session: Arc::from("session-0000"),
        }
    }
}

/// Reports approval-wait progress to the requesting client over its own peer,
/// using the token that client supplied, so notifications route to the right
/// session and carry nothing but a sequence number and a fixed sentence.
struct PeerApprovalProgress {
    peer: Peer<RoleServer>,
    token: ProgressToken,
}

impl ApprovalProgress for PeerApprovalProgress {
    fn report(&self, sequence: u32) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let params = ProgressNotificationParam::new(self.token.clone(), f64::from(sequence))
                .with_message(APPROVAL_WAIT_MESSAGE.to_owned());
            let _ = self
                .peer
                .send_notification(ServerNotification::ProgressNotification(
                    ProgressNotification::new(params),
                ))
                .await;
        })
    }
}

impl Default for BridgeMcpServer {
    fn default() -> Self {
        Self::new(shared_capability_registry())
    }
}

impl fmt::Debug for BridgeMcpServer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BridgeMcpServer")
    }
}

impl ServerHandler for BridgeMcpServer {
    fn get_info(&self) -> ServerInfo {
        let mut implementation = Implementation::new("mcpatch", PRODUCT_VERSION);
        implementation.title = Some("MCPatch".to_owned());
        implementation.description = Some(
            "Safe, typed website capabilities provided by the MCPatch browser runtime.".to_owned(),
        );

        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(implementation)
            .with_instructions("MCPatch exposes only enabled, context-bound browser capabilities.");
        info.protocol_version = ProtocolVersion::V_2026_07_28;
        info
    }

    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Cow::Borrowed(SUPPORTED_MCP_VERSIONS)
    }

    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        if request.and_then(|request| request.cursor).is_some() {
            return Err(McpError::invalid_params(
                "MCPatch tools/list does not accept a cursor",
                None,
            ));
        }

        let capabilities = {
            let registry = self.registry.lock().await;
            registry.visible_capabilities()
        };
        let tools = capabilities.into_iter().map(project_capability).collect();
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let progress = context.meta.get_progress_token().map(|token| {
            Arc::new(PeerApprovalProgress {
                peer: context.peer.clone(),
                token,
            }) as Arc<dyn ApprovalProgress>
        });
        let client_name = context
            .peer
            .peer_info()
            .map(|info| info.client_info.name.clone());
        let requester = requester_label(client_name.as_deref(), &self.session);
        self.calls
            .execute(request, context.ct, progress, requester)
            .await
    }
}

fn project_capability(capability: Capability) -> Tool {
    let read_only = capability.risk == Risk::Read;
    let annotations = if read_only {
        ToolAnnotations::new()
            .read_only(true)
            .destructive(false)
            .idempotent(true)
    } else {
        ToolAnnotations::new().read_only(false)
    };
    let mut tool = Tool::new(
        capability.name,
        capability.description,
        Arc::new(capability.input_schema),
    )
    .with_annotations(annotations);
    tool.title = capability.title;
    tool.output_schema = capability.output_schema.map(Arc::new);
    tool
}

#[cfg(test)]
mod tests {
    use rmcp::{
        ServerHandler,
        model::{ProtocolVersion, ToolAnnotations},
    };

    use super::{BridgeMcpServer, project_capability};
    use crate::protocol::{Message, parse_message};

    #[test]
    fn derives_a_short_hex_session_label_per_accepted_session() {
        let template = BridgeMcpServer::default();
        assert_eq!(template.session_label(), "session-0000");
        assert_eq!(template.for_session(7).session_label(), "session-0007");
        assert_eq!(
            template.for_session(0x00ab_cdef).session_label(),
            "session-abcdef"
        );
    }

    #[test]
    fn advertises_tools_without_placeholder_tools() {
        let server = BridgeMcpServer::default();
        let info = server.get_info();
        assert!(info.capabilities.tools.is_some());
        assert_eq!(info.server_info.name, "mcpatch");
        assert_eq!(info.protocol_version, ProtocolVersion::V_2026_07_28);
    }

    #[test]
    fn projects_only_the_public_typed_capability_contract() {
        let message = parse_message(include_bytes!(
            "../../../../packages/protocol/fixtures/v2/valid/demo-capability-snapshot.json"
        ))
        .unwrap();
        let Message::CapabilitySnapshot(snapshot) = message else {
            panic!("demo fixture must be a capability snapshot");
        };
        let capability = snapshot.capabilities.into_iter().next().unwrap();
        let expected_input = capability.input_schema.clone();
        let expected_output = capability.output_schema.clone().unwrap();

        let tool = project_capability(capability);

        assert_eq!(tool.name, "mcpatch.demo.status");
        assert_eq!(tool.title.as_deref(), Some("MCPatch demo status"));
        assert_eq!(
            tool.description.as_deref(),
            Some("Return deterministic MCPatch demo runtime status.")
        );
        assert_eq!(tool.input_schema.as_ref(), &expected_input);
        assert_eq!(tool.output_schema.as_deref(), Some(&expected_output));
        assert_eq!(
            tool.annotations,
            Some(
                ToolAnnotations::new()
                    .read_only(true)
                    .destructive(false)
                    .idempotent(true)
            )
        );
        assert!(tool.meta.is_none());
        assert!(tool.icons.is_none());
    }
}
