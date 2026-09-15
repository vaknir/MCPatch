use thiserror::Error;
use tokio::task::JoinError;

#[cfg(unix)]
use crate::local_ipc::{UnixIpcError, UnixIpcErrorCode};
#[cfg(windows)]
use crate::local_ipc::{WindowsIpcError, WindowsIpcErrorCode};

#[derive(Debug, Error)]
pub enum BridgeCoreError {
    #[error("runtime epoch generation failed")]
    Epoch(getrandom::Error),
    #[cfg(unix)]
    #[error("local transport failed")]
    Transport(#[from] UnixIpcError),
    #[cfg(windows)]
    #[error("local transport failed")]
    Transport(#[from] WindowsIpcError),
    #[error("core session task failed")]
    SessionTask(#[source] JoinError),
}

impl BridgeCoreError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Epoch(_) => "core_epoch_failed",
            #[cfg(unix)]
            Self::Transport(error) => match error.code() {
                UnixIpcErrorCode::CoreAlreadyRunning => "core_already_running",
                _ => "core_transport_failed",
            },
            #[cfg(windows)]
            Self::Transport(error) => match error.code() {
                WindowsIpcErrorCode::CoreAlreadyRunning => "core_already_running",
                WindowsIpcErrorCode::WorkerFailed => "core_worker_failed",
                _ => "core_transport_failed",
            },
            Self::SessionTask(_) => "core_session_task_failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CoreStopReason {
    Idle,
    Shutdown,
}
