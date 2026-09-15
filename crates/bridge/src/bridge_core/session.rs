use tokio::io::{AsyncRead, AsyncWrite};
use tokio_util::sync::CancellationToken;

use crate::{
    local_ipc::{EndpointRole, read_json_frame_with_partial_timeout},
    mcp::{BridgeMcpServer, PARTIAL_LOCAL_FRAME_TIMEOUT, run_core_mcp_session},
};

pub(super) const MAX_SESSIONS_PER_ROLE: usize = 8;

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
    mcp_server: BridgeMcpServer,
    shutdown: CancellationToken,
) -> EndpointRole
where
    R: AsyncRead + Send + Unpin + 'static,
    W: AsyncWrite + Send + Unpin + 'static,
{
    match role {
        EndpointRole::Browser => drain_browser_session(reader, writer, shutdown).await,
        EndpointRole::Mcp => {
            let session_shutdown = shutdown.child_token();
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

async fn drain_browser_session<R, W>(mut reader: R, _writer: W, shutdown: CancellationToken)
where
    R: AsyncRead + Unpin,
{
    loop {
        let frame = tokio::select! {
            biased;
            () = shutdown.cancelled() => return,
            frame = read_json_frame_with_partial_timeout(
                &mut reader,
                PARTIAL_LOCAL_FRAME_TIMEOUT,
            ) => frame,
        };
        if !matches!(frame, Ok(Some(_))) {
            return;
        }
    }
}
