use std::time::Duration;

use tokio::{task::JoinSet, time::Instant};
use tokio_util::sync::CancellationToken;

use super::{BridgeCoreError, BridgeEpoch, CoreStopReason};
use crate::local_ipc::{
    AuthenticatedUnixStream, EndpointRole, UnixCoreElection, UnixEndpointListener, UnixIpcError,
    UnixIpcErrorCode, UnixRuntime,
};

/// Elected Unix bridge core holding both parser-role endpoints.
#[derive(Debug)]
pub struct UnixBridgeCore {
    _election: UnixCoreElection,
    browser_listener: UnixEndpointListener,
    mcp_listener: UnixEndpointListener,
    epoch: BridgeEpoch,
}

impl UnixBridgeCore {
    pub async fn start(runtime: UnixRuntime) -> Result<Self, BridgeCoreError> {
        let election = runtime.try_elect_core()?;
        let browser_listener = runtime.bind_after_election(EndpointRole::Browser).await?;
        let mcp_listener = runtime.bind_after_election(EndpointRole::Mcp).await?;
        let epoch = BridgeEpoch::generate().map_err(BridgeCoreError::Epoch)?;

        Ok(Self {
            _election: election,
            browser_listener,
            mcp_listener,
            epoch,
        })
    }

    pub const fn epoch(&self) -> &BridgeEpoch {
        &self.epoch
    }

    /// Serve authenticated peers until shutdown or a full idle interval elapses.
    pub async fn run(
        self,
        idle_timeout: Duration,
        shutdown: CancellationToken,
    ) -> Result<CoreStopReason, BridgeCoreError> {
        let mut sessions = JoinSet::new();
        let mut idle_deadline = Some(Instant::now() + idle_timeout);

        let reason = loop {
            tokio::select! {
                result = self.browser_listener.accept_authenticated() => {
                    accept_session(result, EndpointRole::Browser, &mut sessions, &mut idle_deadline)?;
                }
                result = self.mcp_listener.accept_authenticated() => {
                    accept_session(result, EndpointRole::Mcp, &mut sessions, &mut idle_deadline)?;
                }
                completed = sessions.join_next(), if !sessions.is_empty() => {
                    if completed.is_some_and(|result| result.is_err()) {
                        tracing::warn!(target: "mcpatch", event = "core_session_task_failed");
                    }
                    if sessions.is_empty() {
                        idle_deadline = Some(Instant::now() + idle_timeout);
                    }
                }
                () = wait_for_idle(idle_deadline), if idle_deadline.is_some() => {
                    break CoreStopReason::Idle;
                }
                () = shutdown.cancelled() => {
                    break CoreStopReason::Shutdown;
                }
            }
        };

        sessions.abort_all();
        while sessions.join_next().await.is_some() {}
        Ok(reason)
    }
}

fn accept_session(
    result: Result<AuthenticatedUnixStream, UnixIpcError>,
    role: EndpointRole,
    sessions: &mut JoinSet<EndpointRole>,
    idle_deadline: &mut Option<Instant>,
) -> Result<(), BridgeCoreError> {
    match result {
        Ok(stream) => {
            sessions.spawn(drain_session(stream, role));
            *idle_deadline = None;
            Ok(())
        }
        Err(error)
            if matches!(
                error.code(),
                UnixIpcErrorCode::PeerCredentialsUnavailable | UnixIpcErrorCode::PeerUnauthorized
            ) =>
        {
            tracing::warn!(target: "mcpatch", event = "core_peer_rejected");
            Ok(())
        }
        Err(error) => Err(BridgeCoreError::Transport(error)),
    }
}

async fn drain_session(mut stream: AuthenticatedUnixStream, role: EndpointRole) -> EndpointRole {
    while matches!(stream.read_json().await, Ok(Some(_))) {}
    role
}

async fn wait_for_idle(deadline: Option<Instant>) {
    if let Some(deadline) = deadline {
        tokio::time::sleep_until(deadline).await;
    } else {
        std::future::pending().await
    }
}
