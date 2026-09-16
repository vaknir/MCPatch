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

/// Explicit override for hosts without a login-session runtime directory, such as
/// containers, cron, or some SSH sessions. It selects the base only; the directory
/// still has to pass the same ownership and mode checks as a session directory.
const RUNTIME_DIRECTORY_OVERRIDE_ENV: &str = "MCPATCH_RUNTIME_DIR";
#[cfg(target_os = "linux")]
const SESSION_RUNTIME_DIRECTORY_ENV: &str = "XDG_RUNTIME_DIR";

#[cfg(target_os = "linux")]
fn default_runtime_base() -> Result<PathBuf, UnixIpcError> {
    runtime_base_from(
        env::var_os(RUNTIME_DIRECTORY_OVERRIDE_ENV),
        env::var_os(SESSION_RUNTIME_DIRECTORY_ENV),
    )
}

#[cfg(target_os = "macos")]
fn default_runtime_base() -> Result<PathBuf, UnixIpcError> {
    runtime_base_from(
        env::var_os(RUNTIME_DIRECTORY_OVERRIDE_ENV),
        Some(env::temp_dir().into_os_string()),
    )
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn default_runtime_base() -> Result<PathBuf, UnixIpcError> {
    runtime_base_from(env::var_os(RUNTIME_DIRECTORY_OVERRIDE_ENV), None)
}

/// Picks the first non-empty candidate: the explicit override, then the platform
/// session directory. An empty value is treated as unset so a stray `VAR=` in a
/// service file cannot select the current directory.
fn runtime_base_from(
    override_value: Option<std::ffi::OsString>,
    session_value: Option<std::ffi::OsString>,
) -> Result<PathBuf, UnixIpcError> {
    [override_value, session_value]
        .into_iter()
        .flatten()
        .find(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| UnixIpcError::without_source(UnixIpcErrorCode::RuntimeUnavailable))
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::{UnixIpcErrorCode, runtime_base_from};

    #[test]
    fn override_wins_over_the_session_directory() {
        let base = runtime_base_from(
            Some(OsString::from("/override")),
            Some(OsString::from("/session")),
        )
        .expect("override must resolve");
        assert_eq!(base.as_os_str(), "/override");
    }

    #[test]
    fn session_directory_is_used_when_no_override_is_set() {
        let base = runtime_base_from(None, Some(OsString::from("/session")))
            .expect("session directory must resolve");
        assert_eq!(base.as_os_str(), "/session");
    }

    #[test]
    fn empty_values_count_as_unset() {
        let base = runtime_base_from(Some(OsString::new()), Some(OsString::from("/session")))
            .expect("empty override must fall through");
        assert_eq!(base.as_os_str(), "/session");
        let missing = runtime_base_from(Some(OsString::new()), Some(OsString::new()))
            .expect_err("two empty values leave no runtime directory");
        assert_eq!(missing.code(), UnixIpcErrorCode::RuntimeUnavailable);
    }

    #[test]
    fn no_candidates_is_a_distinct_unavailable_failure() {
        let error = runtime_base_from(None, None).expect_err("nothing to resolve");
        assert_eq!(error.code(), UnixIpcErrorCode::RuntimeUnavailable);
        assert_eq!(
            error.code().core_startup_code(),
            "core_runtime_directory_unavailable"
        );
        assert!(error.code().operator_hint().is_some());
    }
}
