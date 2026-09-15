use std::time::Duration;

use tokio::{task::JoinSet, time::Instant};
use tokio_util::sync::CancellationToken;

use super::{
    BridgeCoreError, BridgeEpoch, CoreStopReason,
    session::{CoreSessionServices, SessionCounts, run_stream_session},
};
use crate::{
    browser::BrowserSessionManager,
    local_ipc::{
        AuthenticatedUnixStream, EndpointRole, UnixCoreElection, UnixEndpointListener,
        UnixIpcError, UnixIpcErrorCode, UnixRuntime,
    },
    mcp::BridgeMcpServer,
    routing::shared_capability_registry,
};

/// Elected Unix bridge core holding both parser-role endpoints.
#[derive(Debug)]
pub struct UnixBridgeCore {
    _election: UnixCoreElection,
    browser_listener: UnixEndpointListener,
    mcp_listener: UnixEndpointListener,
    epoch: BridgeEpoch,
    services: CoreSessionServices,
}

impl UnixBridgeCore {
    pub async fn start(runtime: UnixRuntime) -> Result<Self, BridgeCoreError> {
        let election = runtime.try_elect_core()?;
        let browser_listener = runtime
            .bind_after_election(&election, EndpointRole::Browser)
            .await?;
        let mcp_listener = runtime
            .bind_after_election(&election, EndpointRole::Mcp)
            .await?;
        let epoch = BridgeEpoch::generate().map_err(BridgeCoreError::Epoch)?;
        let browser_namespace = BridgeEpoch::generate().map_err(BridgeCoreError::Epoch)?;
        let registry = shared_capability_registry();

        Ok(Self {
            _election: election,
            browser_listener,
            mcp_listener,
            services: CoreSessionServices::new(
                BridgeMcpServer::new(registry.clone()),
                BrowserSessionManager::new(registry, browser_namespace.as_str()),
            ),
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
        let mut session_counts = SessionCounts::default();
        let mut idle_deadline = Some(Instant::now() + idle_timeout);

        let reason = loop {
            tokio::select! {
                result = self.browser_listener.accept_authenticated() => {
                    accept_session(
                        result,
                        EndpointRole::Browser,
                        &self.services,
                        &shutdown,
                        &mut sessions,
                        &mut session_counts,
                        &mut idle_deadline,
                    )?;
                }
                result = self.mcp_listener.accept_authenticated() => {
                    accept_session(
                        result,
                        EndpointRole::Mcp,
                        &self.services,
                        &shutdown,
                        &mut sessions,
                        &mut session_counts,
                        &mut idle_deadline,
                    )?;
                }
                completed = sessions.join_next(), if !sessions.is_empty() => {
                    let Some(completed) = completed else {
                        continue;
                    };
                    let role = completed.map_err(BridgeCoreError::SessionTask)?;
                    session_counts.remove(role);
                    if session_counts.is_empty() {
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
    services: &CoreSessionServices,
    shutdown: &CancellationToken,
    sessions: &mut JoinSet<EndpointRole>,
    session_counts: &mut SessionCounts,
    idle_deadline: &mut Option<Instant>,
) -> Result<(), BridgeCoreError> {
    match result {
        Ok(stream) => {
            if !session_counts.try_add(role) {
                tracing::warn!(target: "mcpatch", event = "core_session_rejected", reason = "limit");
                return Ok(());
            }
            let (reader, writer) = stream.into_inner().into_split();
            sessions.spawn(run_stream_session(
                role,
                reader,
                writer,
                services.clone(),
                shutdown.clone(),
            ));
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

async fn wait_for_idle(deadline: Option<Instant>) {
    if let Some(deadline) = deadline {
        tokio::time::sleep_until(deadline).await;
    } else {
        std::future::pending().await
    }
}
