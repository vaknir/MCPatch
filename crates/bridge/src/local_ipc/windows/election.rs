use std::{
    sync::mpsc::{self, Receiver, SyncSender},
    thread::{self, JoinHandle},
};

use mcpatch_windows_kernel::{ThreadBoundNamedMutex, TryAcquireNamedMutexError};

use super::{WindowsRuntime, security::mutex_security_descriptor_for};
use crate::local_ipc::{InstallChannel, WindowsIpcError, WindowsIpcErrorCode};

/// Dedicated thread retaining per-logon bridge-core ownership.
#[derive(Debug)]
pub struct WindowsCoreElection {
    stop: Option<SyncSender<()>>,
    completed: Receiver<Result<(), WindowsIpcError>>,
    thread: Option<JoinHandle<()>>,
}

impl WindowsRuntime {
    pub fn core_mutex_name(&self) -> &'static str {
        mutex_name(self.channel)
    }

    /// Try to become this logon's only bridge core for the install channel.
    pub fn try_elect_core(&self) -> Result<WindowsCoreElection, WindowsIpcError> {
        let mutex_name = self.core_mutex_name();
        let logon_sid = self.expected_logon_sid.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let (stop_tx, stop_rx) = mpsc::sync_channel(1);
        let (completed_tx, completed_rx) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("mcpatch-core-election".to_owned())
            .spawn(move || {
                let descriptor = mutex_security_descriptor_for(&logon_sid);
                let acquired = descriptor.and_then(|descriptor| {
                    ThreadBoundNamedMutex::try_acquire(mutex_name, &descriptor).map_err(mutex_error)
                });
                let mutex = match acquired {
                    Ok(mutex) => mutex,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };

                if ready_tx.send(Ok(())).is_err() {
                    return;
                }
                let _ = stop_rx.recv();
                let released = mutex.release().map_err(|error| {
                    WindowsIpcError::with_source(WindowsIpcErrorCode::MutexUnavailable, error)
                });
                let _ = completed_tx.send(released);
            })
            .map_err(|error| {
                WindowsIpcError::with_source(WindowsIpcErrorCode::WorkerFailed, error)
            })?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(WindowsCoreElection {
                stop: Some(stop_tx),
                completed: completed_rx,
                thread: Some(thread),
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(_) => {
                let _ = thread.join();
                Err(WindowsIpcError::without_source(
                    WindowsIpcErrorCode::WorkerFailed,
                ))
            }
        }
    }
}

impl WindowsCoreElection {
    pub fn release(mut self) -> Result<(), WindowsIpcError> {
        self.finish()
    }

    fn finish(&mut self) -> Result<(), WindowsIpcError> {
        let Some(stop) = self.stop.take() else {
            return Ok(());
        };
        let sent = stop.send(()).is_ok();
        let completed = self.completed.recv().ok();
        let joined = self
            .thread
            .take()
            .is_some_and(|thread| thread.join().is_ok());

        if !sent || !joined {
            return Err(WindowsIpcError::without_source(
                WindowsIpcErrorCode::WorkerFailed,
            ));
        }
        completed.unwrap_or_else(|| {
            Err(WindowsIpcError::without_source(
                WindowsIpcErrorCode::WorkerFailed,
            ))
        })
    }
}

impl Drop for WindowsCoreElection {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

fn mutex_error(error: TryAcquireNamedMutexError) -> WindowsIpcError {
    match error {
        TryAcquireNamedMutexError::AlreadyExists => {
            WindowsIpcError::without_source(WindowsIpcErrorCode::CoreAlreadyRunning)
        }
        TryAcquireNamedMutexError::InvalidName => {
            WindowsIpcError::without_source(WindowsIpcErrorCode::MutexUnavailable)
        }
        TryAcquireNamedMutexError::Io(error) => {
            WindowsIpcError::with_source(WindowsIpcErrorCode::MutexUnavailable, error)
        }
    }
}

const fn mutex_name(channel: InstallChannel) -> &'static str {
    match channel {
        InstallChannel::Development => r"Local\MCPatch-development-core-v1",
        InstallChannel::Production => r"Local\MCPatch-production-core-v1",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_have_distinct_local_mutex_names() {
        assert_eq!(
            mutex_name(InstallChannel::Development),
            r"Local\MCPatch-development-core-v1"
        );
        assert_ne!(
            mutex_name(InstallChannel::Development),
            mutex_name(InstallChannel::Production)
        );
    }
}
