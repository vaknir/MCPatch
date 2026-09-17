use std::io;

use thiserror::Error;

use crate::local_ipc::{LocalCoreConnectionError, LocalCoreConnectionErrorCode};

/// Stable failures from bounded bridge-core rendezvous.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CoreRendezvousErrorCode {
    Connection(LocalCoreConnectionErrorCode),
    EntropyUnavailable,
    SpawnFailed,
    StartupTimeout,
}

impl CoreRendezvousErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Connection(code) => code.as_str(),
            Self::EntropyUnavailable => "core_startup_entropy_unavailable",
            Self::SpawnFailed => "core_spawn_failed",
            Self::StartupTimeout => "core_startup_timeout",
        }
    }

    /// Fixed, path-free guidance for failures an operator can correct.
    pub const fn operator_hint(self) -> Option<&'static str> {
        match self {
            Self::Connection(code) => code.operator_hint(),
            Self::EntropyUnavailable | Self::SpawnFailed | Self::StartupTimeout => None,
        }
    }
}

/// Payload-free rendezvous error whose sources are never written to audit logs.
#[derive(Debug, Error)]
pub enum CoreRendezvousError {
    #[error("local core connection failed")]
    Connection(#[source] LocalCoreConnectionError),
    #[error("bridge core startup entropy unavailable")]
    Entropy(getrandom::Error),
    #[error("bridge core process spawn failed")]
    Spawn(#[source] io::Error),
    #[error("bridge core startup timed out")]
    Timeout,
}

impl CoreRendezvousError {
    pub const fn code(&self) -> CoreRendezvousErrorCode {
        match self {
            Self::Connection(error) => CoreRendezvousErrorCode::Connection(error.code()),
            Self::Entropy(_) => CoreRendezvousErrorCode::EntropyUnavailable,
            Self::Spawn(_) => CoreRendezvousErrorCode::SpawnFailed,
            Self::Timeout => CoreRendezvousErrorCode::StartupTimeout,
        }
    }
}

impl From<LocalCoreConnectionError> for CoreRendezvousError {
    fn from(error: LocalCoreConnectionError) -> Self {
        Self::Connection(error)
    }
}
