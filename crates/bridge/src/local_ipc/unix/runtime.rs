use std::{
    env, fs, io,
    os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
};

use tokio::net::UnixStream;

use crate::local_ipc::{EndpointRole, InstallChannel, UnixIpcError, UnixIpcErrorCode};

const PRIVATE_DIRECTORY_MODE: u32 = 0o700;

/// Verified per-user Unix runtime directory and its fixed endpoints.
#[derive(Clone, Debug)]
pub struct UnixRuntime {
    directory: PathBuf,
    expected_uid: u32,
}

impl UnixRuntime {
    /// Prepare MCPatch's runtime directory under the platform user-runtime base.
    pub async fn prepare(channel: InstallChannel) -> Result<Self, UnixIpcError> {
        let base = default_runtime_base()?;
        Self::prepare_at(&base, channel).await
    }

    /// Prepare a runtime beneath an explicit trusted base, primarily for tests.
    pub async fn prepare_at(base: &Path, channel: InstallChannel) -> Result<Self, UnixIpcError> {
        if !base.is_absolute() {
            return Err(UnixIpcError::without_source(
                UnixIpcErrorCode::UnsafeRuntimeDirectory,
            ));
        }
        let expected_uid = current_uid().await?;
        verify_private_directory(base, expected_uid)?;

        let product_directory = base.join("mcpatch");
        ensure_private_directory(&product_directory, expected_uid)?;
        let directory = product_directory.join(channel.directory_name());
        ensure_private_directory(&directory, expected_uid)?;

        Ok(Self {
            directory,
            expected_uid,
        })
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub const fn expected_uid(&self) -> u32 {
        self.expected_uid
    }

    pub fn socket_path(&self, role: EndpointRole) -> PathBuf {
        self.directory.join(role.socket_file_name())
    }

    pub(crate) fn verify(&self) -> Result<(), UnixIpcError> {
        verify_private_directory(&self.directory, self.expected_uid)
    }
}

async fn current_uid() -> Result<u32, UnixIpcError> {
    let (stream, _peer) = UnixStream::pair().map_err(io_error)?;
    stream
        .peer_cred()
        .map(|credentials| credentials.uid())
        .map_err(|error| {
            UnixIpcError::with_source(UnixIpcErrorCode::PeerCredentialsUnavailable, error)
        })
}

fn ensure_private_directory(path: &Path, expected_uid: u32) -> Result<(), UnixIpcError> {
    let mut builder = fs::DirBuilder::new();
    builder.mode(PRIVATE_DIRECTORY_MODE);
    match builder.create(path) {
        Ok(()) => {
            fs::set_permissions(path, fs::Permissions::from_mode(PRIVATE_DIRECTORY_MODE))
                .map_err(io_error)?;
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(io_error(error)),
    }
    verify_private_directory(path, expected_uid)
}

fn verify_private_directory(path: &Path, expected_uid: u32) -> Result<(), UnixIpcError> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if !metadata.file_type().is_dir()
        || metadata.uid() != expected_uid
        || metadata.mode() & 0o777 != PRIVATE_DIRECTORY_MODE
    {
        return Err(UnixIpcError::without_source(
            UnixIpcErrorCode::UnsafeRuntimeDirectory,
        ));
    }
    Ok(())
}

fn io_error(error: io::Error) -> UnixIpcError {
    UnixIpcError::with_source(UnixIpcErrorCode::Io, error)
}

#[cfg(target_os = "linux")]
fn default_runtime_base() -> Result<PathBuf, UnixIpcError> {
    let path = env::var_os("XDG_RUNTIME_DIR")
        .ok_or_else(|| UnixIpcError::without_source(UnixIpcErrorCode::RuntimeUnavailable))?;
    Ok(PathBuf::from(path))
}

#[cfg(target_os = "macos")]
fn default_runtime_base() -> Result<PathBuf, UnixIpcError> {
    Ok(env::temp_dir())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn default_runtime_base() -> Result<PathBuf, UnixIpcError> {
    Err(UnixIpcError::without_source(
        UnixIpcErrorCode::RuntimeUnavailable,
    ))
}
