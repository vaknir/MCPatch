use std::borrow::Cow;

use rmcp::{
    ServerHandler,
    model::{Implementation, ProtocolVersion, ServerCapabilities, ServerInfo},
};

use crate::PRODUCT_VERSION;

const SUPPORTED_MCP_VERSIONS: &[ProtocolVersion] =
    &[ProtocolVersion::V_2025_11_25, ProtocolVersion::V_2026_07_28];

/// Core-owned MCP handler. Browser capabilities will be injected in later slices.
#[derive(Clone, Debug, Default)]
pub struct BridgeMcpServer;

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
}

#[cfg(test)]
mod tests {
    use rmcp::{ServerHandler, model::ProtocolVersion};

    use super::BridgeMcpServer;

    #[test]
    fn advertises_tools_without_placeholder_tools() {
        let server = BridgeMcpServer;
        let info = server.get_info();
        assert!(info.capabilities.tools.is_some());
        assert_eq!(info.server_info.name, "mcpatch");
        assert_eq!(info.protocol_version, ProtocolVersion::V_2026_07_28);
    }
}
