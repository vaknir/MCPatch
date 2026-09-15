use std::{
    fs::{File, OpenOptions, TryLockError},
    io,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

use super::UnixRuntime;
use crate::local_ipc::{UnixIpcError, UnixIpcErrorCode};

const PRIVATE_LOCK_MODE: u32 = 0o600;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LockIdentity {
    device: u64,
    inode: u64,
}

/// Held per-user election lock. Dropping it releases core ownership.
#[derive(Debug)]
pub struct UnixCoreElection {
    file: File,
    path: PathBuf,
    identity: LockIdentity,
}

impl UnixRuntime {
    pub fn core_lock_path(&self) -> std::path::PathBuf {
        self.directory().join("core-v1.lock")
    }

    /// Try to become the only bridge core for this user and install channel.
    pub fn try_elect_core(&self) -> Result<UnixCoreElection, UnixIpcError> {
        self.verify()?;
        let path = self.core_lock_path();
        let file = open_lock_file(&path)?;
        let identity = verify_open_lock(&file, &path, self.expected_uid())?;

        match file.try_lock() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => {
                return Err(UnixIpcError::without_source(
                    UnixIpcErrorCode::CoreAlreadyRunning,
                ));
            }
            Err(TryLockError::Error(error)) => {
                return Err(UnixIpcError::with_source(UnixIpcErrorCode::Io, error));
            }
        }

        if verify_open_lock(&file, &path, self.expected_uid())? != identity {
            return Err(UnixIpcError::without_source(UnixIpcErrorCode::UnsafeLock));
        }
        Ok(UnixCoreElection {
            file,
            path,
            identity,
        })
    }
}

impl UnixCoreElection {
    pub(super) fn authorizes(&self, runtime: &UnixRuntime) -> Result<(), UnixIpcError> {
        if self.path != runtime.core_lock_path()
            || verify_open_lock(&self.file, &self.path, runtime.expected_uid())? != self.identity
        {
            return Err(UnixIpcError::without_source(UnixIpcErrorCode::UnsafeLock));
        }
        Ok(())
    }
}

fn open_lock_file(path: &Path) -> Result<File, UnixIpcError> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(PRIVATE_LOCK_MODE)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| {
            let code = if error.raw_os_error() == Some(libc::ELOOP) {
                UnixIpcErrorCode::UnsafeLock
            } else {
                UnixIpcErrorCode::Io
            };
            UnixIpcError::with_source(code, error)
        })
}

fn verify_open_lock(
    file: &File,
    path: &Path,
    expected_uid: u32,
) -> Result<LockIdentity, UnixIpcError> {
    let opened = file.metadata().map_err(io_error)?;
    let visible = std::fs::symlink_metadata(path).map_err(io_error)?;
    if !opened.file_type().is_file()
        || !visible.file_type().is_file()
        || opened.uid() != expected_uid
        || visible.uid() != expected_uid
        || opened.mode() & 0o777 != PRIVATE_LOCK_MODE
        || visible.mode() & 0o777 != PRIVATE_LOCK_MODE
        || opened.nlink() != 1
        || visible.nlink() != 1
        || opened.dev() != visible.dev()
        || opened.ino() != visible.ino()
    {
        return Err(UnixIpcError::without_source(UnixIpcErrorCode::UnsafeLock));
    }
    Ok(LockIdentity {
        device: opened.dev(),
        inode: opened.ino(),
    })
}

fn io_error(error: io::Error) -> UnixIpcError {
    UnixIpcError::with_source(UnixIpcErrorCode::Io, error)
}
