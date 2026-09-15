use thiserror::Error;

/// Stable installation and registration failure categories.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum InstallationError {
    #[error("the current platform is unsupported")]
    CurrentPlatformUnsupported,
    #[error("the user installation root is unavailable")]
    EnvironmentUnavailable,
    #[error("the bridge executable is missing or not a regular file")]
    ExecutableInvalid,
    #[error("an installation filesystem operation failed")]
    Filesystem,
    #[error("an installation path has unsafe ownership or permissions")]
    UnsafePermissions,
    #[error("existing native-host files are not owned by MCPatch")]
    ExistingInstallationNotOwned,
    #[error("existing native-host files are incomplete")]
    InstallationInconsistent,
    #[error("an installation path is not canonical and absolute")]
    InvalidPath,
    #[error("the native-host registry entry conflicts with MCPatch")]
    RegistryConflict,
    #[error("the native-host registry could not be updated")]
    Registry,
    #[error("installation metadata could not be serialized")]
    Serialization,
    #[error("operating-system entropy is unavailable")]
    Entropy,
}

impl InstallationError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::CurrentPlatformUnsupported => "installation_platform_unsupported",
            Self::EnvironmentUnavailable => "installation_environment_unavailable",
            Self::ExecutableInvalid => "installation_executable_invalid",
            Self::Filesystem => "installation_filesystem_failed",
            Self::UnsafePermissions => "installation_permissions_unsafe",
            Self::ExistingInstallationNotOwned => "installation_not_owned",
            Self::InstallationInconsistent => "installation_inconsistent",
            Self::InvalidPath => "installation_path_invalid",
            Self::RegistryConflict => "installation_registry_conflict",
            Self::Registry => "installation_registry_failed",
            Self::Serialization => "installation_metadata_invalid",
            Self::Entropy => "installation_entropy_unavailable",
        }
    }
}
