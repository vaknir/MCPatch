use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use tokio::sync::mpsc;

use super::frames::{FramePoll, NonblockingFrameReader};
use crate::local_ipc::{
    AuthenticatedWindowsStream, EndpointRole, WindowsEndpointListener, WindowsIpcError,
    WindowsIpcErrorCode,
};

const MAX_SESSIONS_PER_ROLE: usize = 8;
const EVENT_CAPACITY: usize = MAX_SESSIONS_PER_ROLE * 4 + 8;
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const PARTIAL_FRAME_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug)]
pub(super) enum WorkerEvent {
    Connected,
    Disconnected,
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
    stop: &Arc<AtomicBool>,
    events: &mpsc::Sender<WorkerEvent>,
) {
    let mut sessions = Vec::with_capacity(MAX_SESSIONS_PER_ROLE);
    while !stop.load(Ordering::Acquire) {
        if !reap_finished(&mut sessions) {
            let _ = events.blocking_send(WorkerEvent::WorkerFailed);
            break;
        }

        match listener.try_accept_authenticated() {
            Ok(Some(stream)) if sessions.len() < MAX_SESSIONS_PER_ROLE => {
                match spawn_session_worker(stream, role, Arc::clone(stop), events.clone()) {
                    Ok(session) => sessions.push(session),
                    Err(()) => {
                        let _ = events.blocking_send(WorkerEvent::WorkerFailed);
                        break;
                    }
                }
            }
            Ok(Some(_)) => {
                let _ = events.blocking_send(WorkerEvent::PeerRejected);
            }
            Ok(None) => {}
            Err(error)
                if matches!(
                    error.code(),
                    WindowsIpcErrorCode::IdentityUnavailable
                        | WindowsIpcErrorCode::PeerUnauthorized
                        | WindowsIpcErrorCode::RevertFailed
                ) =>
            {
                let _ = events.blocking_send(WorkerEvent::PeerRejected);
            }
            Err(_) => {
                let _ = events.blocking_send(WorkerEvent::WorkerFailed);
                break;
            }
        }
        thread::sleep(POLL_INTERVAL);
    }

    for session in sessions {
        let _ = session.join();
    }
}

fn spawn_session_worker(
    mut stream: AuthenticatedWindowsStream,
    role: EndpointRole,
    stop: Arc<AtomicBool>,
    events: mpsc::Sender<WorkerEvent>,
) -> Result<JoinHandle<()>, ()> {
    thread::Builder::new()
        .name(session_name(role).to_owned())
        .spawn(move || {
            if events.blocking_send(WorkerEvent::Connected).is_err() {
                return;
            }
            let mut reader = NonblockingFrameReader::new();
            let mut partial_frame_deadline = None;
            while !stop.load(Ordering::Acquire) {
                match reader.poll(&mut stream) {
                    Ok(FramePoll::Complete) => partial_frame_deadline = None,
                    Ok(FramePoll::Pending) => {
                        if reader.has_partial_frame() {
                            let deadline = partial_frame_deadline
                                .get_or_insert_with(|| Instant::now() + PARTIAL_FRAME_TIMEOUT);
                            if Instant::now() >= *deadline {
                                break;
                            }
                        }
                        thread::sleep(POLL_INTERVAL);
                    }
                    Ok(FramePoll::Closed) | Err(_) => break,
                }
            }
            let _ = events.blocking_send(WorkerEvent::Disconnected);
        })
        .map_err(|_| ())
}

fn reap_finished(sessions: &mut Vec<JoinHandle<()>>) -> bool {
    let mut index = 0;
    let mut succeeded = true;
    while index < sessions.len() {
        if sessions[index].is_finished() {
            let session = sessions.swap_remove(index);
            succeeded &= session.join().is_ok();
        } else {
            index += 1;
        }
    }
    succeeded
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

const fn session_name(role: EndpointRole) -> &'static str {
    match role {
        EndpointRole::Browser => "mcpatch-browser-session",
        EndpointRole::Mcp => "mcpatch-mcp-session",
    }
}
