mod workers;

use std::{fmt, time::Duration};

use tokio::{task::JoinSet, time::Instant};
use tokio_util::sync::CancellationToken;

use self::workers::{WindowsCoreWorkers, WorkerEvent};
use super::{
    BridgeCoreError, BridgeEpoch, CoreStopReason,
    session::{CoreSessionServices, SessionCounts, run_stream_session},
};
use crate::{
    browser::BrowserSessionManager,
    local_ipc::{
        EndpointRole, WindowsCoreElection, WindowsIpcError, WindowsIpcErrorCode, WindowsRuntime,
    },
    mcp::BridgeMcpServer,
    routing::shared_capability_registry,
};

pub struct WindowsBridgeCore {
    election: Option<WindowsCoreElection>,
    workers: Option<WindowsCoreWorkers>,
    epoch: BridgeEpoch,
    services: CoreSessionServices,
}

impl fmt::Debug for WindowsBridgeCore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("WindowsBridgeCore([redacted])")
    }
}

impl Drop for WindowsBridgeCore {
    fn drop(&mut self) {
        if let Some(workers) = self.workers.take() {
            drop(workers);
        }
        if let Some(election) = self.election.take() {
            drop(election);
        }
    }
}

impl WindowsBridgeCore {
    pub fn start(runtime: WindowsRuntime) -> Result<Self, BridgeCoreError> {
        let election = runtime.try_elect_core()?;
        let browser_listener = runtime.bind_core_endpoint(EndpointRole::Browser)?;
        let mcp_listener = runtime.bind_core_endpoint(EndpointRole::Mcp)?;
        let epoch = BridgeEpoch::generate().map_err(BridgeCoreError::Epoch)?;
        let browser_namespace = BridgeEpoch::generate().map_err(BridgeCoreError::Epoch)?;
        let workers = WindowsCoreWorkers::start(browser_listener, mcp_listener)?;
        let registry = shared_capability_registry();

        Ok(Self {
            election: Some(election),
            workers: Some(workers),
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

    pub async fn run(
        mut self,
        idle_timeout: Duration,
        shutdown: CancellationToken,
    ) -> Result<CoreStopReason, BridgeCoreError> {
        let mut sessions = JoinSet::new();
        let mut session_counts = SessionCounts::default();
        let mut idle_deadline = Some(Instant::now() + idle_timeout);
        let workers = self.workers.as_mut().ok_or_else(worker_failed)?;

        let reason = loop {
            tokio::select! {
                event = workers.next_event() => {
                    match event.ok_or_else(worker_failed)? {
                        WorkerEvent::Accepted { role, stream } => {
                            if !session_counts.try_add(role) {
                                tracing::warn!(target: "mcpatch", event = "core_session_rejected", reason = "limit");
                                continue;
                            }
                            let stream = stream.into_async()?;
                            let (reader, writer) = stream.split();
                            sessions.spawn(run_stream_session(
                                role,
                                reader,
                                writer,
                                self.services.clone(),
                                shutdown.clone(),
                            ));
                            idle_deadline = None;
                        }
                        WorkerEvent::PeerRejected => {
                            tracing::warn!(target: "mcpatch", event = "core_peer_rejected");
                        }
                        WorkerEvent::WorkerFailed => return Err(worker_failed().into()),
                    }
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
        let workers_result = self.workers.take().ok_or_else(worker_failed)?.stop().await;
        let election_result = self.election.take().ok_or_else(worker_failed)?.release();
        workers_result?;
        election_result?;
        Ok(reason)
    }
}

async fn wait_for_idle(deadline: Option<Instant>) {
    if let Some(deadline) = deadline {
        tokio::time::sleep_until(deadline).await;
    } else {
        std::future::pending().await
    }
}

const fn worker_failed() -> WindowsIpcError {
    WindowsIpcError::without_source(WindowsIpcErrorCode::WorkerFailed)
}
