use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use tokio::sync::mpsc;

use super::super::session::MAX_SESSIONS_PER_ROLE;
use crate::local_ipc::{
    AuthenticatedWindowsStream, EndpointRole, WindowsEndpointListener, WindowsIpcError,
    WindowsIpcErrorCode,
};

const EVENT_CAPACITY: usize = MAX_SESSIONS_PER_ROLE * 4 + 8;
const POLL_INTERVAL: Duration = Duration::from_millis(10);

pub(super) enum WorkerEvent {
    Accepted {
        role: EndpointRole,
        stream: AuthenticatedWindowsStream,
    },
    PeerRejected,
    WorkerFailed,
}

pub(super) struct WindowsCoreWorkers {
    stop: Arc<AtomicBool>,
    events: mpsc::Receiver<WorkerEvent>,
    threads: Vec<JoinHandle<()>>,
}

impl WindowsCoreWorkers {
    pub(super) fn start(
        browser_listener: WindowsEndpointListener,
        mcp_listener: WindowsEndpointListener,
    ) -> Result<Self, WindowsIpcError> {
        let stop = Arc::new(AtomicBool::new(false));
        let (events_tx, events_rx) = mpsc::channel(EVENT_CAPACITY);
        let browser_thread = spawn_accept_worker(
            EndpointRole::Browser,
            browser_listener,
            Arc::clone(&stop),
            events_tx.clone(),
        )?;
        let mcp_thread = match spawn_accept_worker(
            EndpointRole::Mcp,
            mcp_listener,
            Arc::clone(&stop),
            events_tx,
        ) {
            Ok(thread) => thread,
            Err(error) => {
                stop.store(true, Ordering::Release);
                drop(events_rx);
                let _ = browser_thread.join();
                return Err(error);
            }
        };

        Ok(Self {
            stop,
            events: events_rx,
            threads: vec![browser_thread, mcp_thread],
        })
    }

    pub(super) async fn next_event(&mut self) -> Option<WorkerEvent> {
        self.events.recv().await
    }

    pub(super) async fn stop(mut self) -> Result<(), WindowsIpcError> {
        self.stop.store(true, Ordering::Release);
        self.events.close();
        let threads = std::mem::take(&mut self.threads);
        tokio::task::spawn_blocking(move || join_workers(threads))
            .await
            .map_err(|_| worker_failed())?
    }
}

impl Drop for WindowsCoreWorkers {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.events.close();
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

fn spawn_accept_worker(
    role: EndpointRole,
    listener: WindowsEndpointListener,
    stop: Arc<AtomicBool>,
    events: mpsc::Sender<WorkerEvent>,
) -> Result<JoinHandle<()>, WindowsIpcError> {
    thread::Builder::new()
        .name(worker_name(role).to_owned())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                accept_loop(listener, role, &stop, &events);
            }));
            if result.is_err() {
                let _ = events.blocking_send(WorkerEvent::WorkerFailed);
            }
        })
        .map_err(|error| WindowsIpcError::with_source(WindowsIpcErrorCode::WorkerFailed, error))
}

fn accept_loop(
    listener: WindowsEndpointListener,
    role: EndpointRole,
    stop: &AtomicBool,
    events: &mpsc::Sender<WorkerEvent>,
) {
    while !stop.load(Ordering::Acquire) {
        match listener.try_accept_authenticated() {
            Ok(Some(stream)) => {
                if events
                    .blocking_send(WorkerEvent::Accepted { role, stream })
                    .is_err()
                {
                    return;
                }
            }
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error)
                if matches!(
                    error.code(),
                    WindowsIpcErrorCode::IdentityUnavailable
                        | WindowsIpcErrorCode::PeerUnauthorized
                        | WindowsIpcErrorCode::RevertFailed
                ) =>
            {
                if events.blocking_send(WorkerEvent::PeerRejected).is_err() {
                    return;
                }
            }
            Err(_) => {
                let _ = events.blocking_send(WorkerEvent::WorkerFailed);
                return;
            }
        }
    }
}

fn join_workers(threads: Vec<JoinHandle<()>>) -> Result<(), WindowsIpcError> {
    let mut succeeded = true;
    for thread in threads {
        succeeded &= thread.join().is_ok();
    }
    if succeeded {
        Ok(())
    } else {
        Err(worker_failed())
    }
}

const fn worker_failed() -> WindowsIpcError {
    WindowsIpcError::without_source(WindowsIpcErrorCode::WorkerFailed)
}

const fn worker_name(role: EndpointRole) -> &'static str {
    match role {
        EndpointRole::Browser => "mcpatch-browser-accept",
        EndpointRole::Mcp => "mcpatch-mcp-accept",
    }
}
