use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::sync::CancellationToken;

use crate::{
    browser::BrowserSessionManager,
    local_ipc::EndpointRole,
    mcp::{BridgeMcpServer, run_core_mcp_session},
};

pub(super) const MAX_SESSIONS_PER_ROLE: usize = 8;

#[derive(Clone, Debug)]
pub(super) struct CoreSessionServices {
    mcp_server: BridgeMcpServer,
    browser_sessions: BrowserSessionManager,
    /// Monotonic MCP session sequence shared by every clone of the services,
    /// so each accepted client gets a distinct label in approval prompts.
    mcp_sequence: Arc<AtomicU64>,
}

impl CoreSessionServices {
    pub(super) fn new(
        mcp_server: BridgeMcpServer,
        browser_sessions: BrowserSessionManager,
    ) -> Self {
        Self {
            mcp_server,
            browser_sessions,
            mcp_sequence: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Hand out the handler for the next accepted MCP session. Sequences start
    /// at one so the shared template's `session-0000` label never reaches a
    /// real client.
    fn next_mcp_server(&self) -> BridgeMcpServer {
        let sequence = self.mcp_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        self.mcp_server.for_session(sequence)
    }
}

#[derive(Default)]
pub(super) struct SessionCounts {
    browser: usize,
    mcp: usize,
}

impl SessionCounts {
    pub(super) fn try_add(&mut self, role: EndpointRole) -> bool {
        let count = self.count_mut(role);
        if *count >= MAX_SESSIONS_PER_ROLE {
            return false;
        }
        *count += 1;
        true
    }

    pub(super) fn remove(&mut self, role: EndpointRole) {
        let count = self.count_mut(role);
        debug_assert!(*count > 0, "completed sessions must have been counted");
        *count = count.saturating_sub(1);
    }

    pub(super) const fn is_empty(&self) -> bool {
        self.browser == 0 && self.mcp == 0
    }

    fn count_mut(&mut self, role: EndpointRole) -> &mut usize {
        match role {
            EndpointRole::Browser => &mut self.browser,
            EndpointRole::Mcp => &mut self.mcp,
        }
    }
}

pub(super) async fn run_stream_session<R, W>(
    role: EndpointRole,
    reader: R,
    writer: W,
    services: CoreSessionServices,
    shutdown: CancellationToken,
) -> EndpointRole
where
    R: AsyncRead + Send + Unpin + 'static,
    W: AsyncWrite + Send + Unpin + 'static,
{
    match role {
        EndpointRole::Browser => {
            let session_shutdown = shutdown.child_token();
            if let Err(error) = services
                .browser_sessions
                .run(reader, writer, session_shutdown)
                .await
            {
                tracing::warn!(
                    target: "mcpatch",
                    event = "core_browser_session_failed",
                    code = error.code().as_str()
                );
            }
        }
        EndpointRole::Mcp => {
            let session_shutdown = shutdown.child_token();
            let mcp_server = services.next_mcp_server();
            if let Err(error) =
                run_core_mcp_session(mcp_server, reader, writer, session_shutdown).await
            {
                tracing::warn!(
                    target: "mcpatch",
                    event = "core_mcp_session_failed",
                    code = error.code()
                );
            }
        }
    }
    role
}

#[cfg(test)]
mod tests {
    use super::CoreSessionServices;
    use crate::{
        browser::BrowserSessionManager, mcp::BridgeMcpServer, routing::shared_capability_registry,
    };

    #[test]
    fn every_accepted_mcp_session_gets_a_distinct_label_across_clones() {
        let registry = shared_capability_registry();
        let services = CoreSessionServices::new(
            BridgeMcpServer::new(registry.clone()),
            BrowserSessionManager::new(registry, "namespace"),
        );
        let clone = services.clone();

        let first = services.next_mcp_server();
        let second = clone.next_mcp_server();

        assert_eq!(first.session_label(), "session-0001");
        assert_eq!(second.session_label(), "session-0002");
    }
}
