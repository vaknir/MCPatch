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
}

impl CoreSessionServices {
    pub(super) fn new(
        mcp_server: BridgeMcpServer,
        browser_sessions: BrowserSessionManager,
    ) -> Self {
        Self {
            mcp_server,
            browser_sessions,
        }
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
            if let Err(error) =
                run_core_mcp_session(services.mcp_server, reader, writer, session_shutdown).await
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
