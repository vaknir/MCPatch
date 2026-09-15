mod frames;
mod workers;

use std::{fmt, time::Duration};

use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use self::workers::{WindowsCoreWorkers, WorkerEvent};
use super::{BridgeCoreError, BridgeEpoch, CoreStopReason};
use crate::local_ipc::{
    EndpointRole, WindowsCoreElection, WindowsIpcError, WindowsIpcErrorCode, WindowsRuntime,
};

pub struct WindowsBridgeCore {
    election: Option<WindowsCoreElection>,
    workers: Option<WindowsCoreWorkers>,
    epoch: BridgeEpoch,
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
        let workers = WindowsCoreWorkers::start(browser_listener, mcp_listener)?;

        Ok(Self {
            election: Some(election),
            workers: Some(workers),
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
        let mut peer_count = 0_usize;
        let mut idle_deadline = Some(Instant::now() + idle_timeout);
        let workers = self.workers.as_mut().ok_or_else(worker_failed)?;

        let reason = loop {
            tokio::select! {
                biased;
                event = workers.next_event() => {
                    match event.ok_or_else(worker_failed)? {
                        WorkerEvent::Connected => {
                            peer_count = peer_count.checked_add(1).ok_or_else(worker_failed)?;
                            idle_deadline = None;
                        }
                        WorkerEvent::Disconnected => {
                            peer_count = peer_count.checked_sub(1).ok_or_else(worker_failed)?;
                            if peer_count == 0 {
                                idle_deadline = Some(Instant::now() + idle_timeout);
                            }
                        }
                        WorkerEvent::PeerRejected => {
                            tracing::warn!(target: "mcpatch", event = "core_peer_rejected");
                        }
                        WorkerEvent::WorkerFailed => return Err(worker_failed().into()),
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
