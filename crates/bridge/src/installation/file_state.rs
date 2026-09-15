use std::{
    fs::{self, File},
    io::{ErrorKind, Read},
    path::Path,
};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

use super::{
    HostPlatform, InstallReceipt, InstallationError, InstallationPlan, NativeHostManifest,
    validate_canonical_absolute,
};

const MAX_METADATA_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ExistingFiles {
    Absent,
    Owned { exact: bool },
}

impl ExistingFiles {
    pub(super) const fn is_present(self) -> bool {
        matches!(self, Self::Owned { .. })
    }
}

pub(super) fn inspect_files(plan: &InstallationPlan) -> Result<ExistingFiles, InstallationError> {
    let manifest_path = Path::new(plan.manifest_path());
    let receipt_path = Path::new(plan.receipt_path());
    let manifest_exists = path_exists(manifest_path)?;
    let receipt_exists = path_exists(receipt_path)?;
    match (manifest_exists, receipt_exists) {
        (false, false) => return Ok(ExistingFiles::Absent),
        (true, true) => {}
        _ => return Err(InstallationError::InstallationInconsistent),
    }

    validate_existing_directory(
        plan,
        manifest_path
            .parent()
            .ok_or(InstallationError::InvalidPath)?,
    )?;
    validate_owned_regular_file(plan, manifest_path)?;
    validate_owned_regular_file(plan, receipt_path)?;
    let manifest_bytes = read_bounded(manifest_path)?;
    let receipt_bytes = read_bounded(receipt_path)?;
    let manifest: NativeHostManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| InstallationError::ExistingInstallationNotOwned)?;
    let receipt: InstallReceipt = serde_json::from_slice(&receipt_bytes)
        .map_err(|_| InstallationError::ExistingInstallationNotOwned)?;
    if !manifest.is_owned()
        || validate_canonical_absolute(plan.platform(), manifest.bridge_path()).is_err()
        || !receipt.owns(&manifest_bytes)
    {
        return Err(InstallationError::ExistingInstallationNotOwned);
    }

    Ok(ExistingFiles::Owned {
        exact: manifest_bytes == plan.manifest_json() && receipt_bytes == plan.receipt_json(),
    })
}

pub(super) fn validate_bridge(plan: &InstallationPlan) -> Result<(), InstallationError> {
    validate_root(plan)?;
    let path = Path::new(plan.bridge_path());
    let canonical = fs::canonicalize(path).map_err(|_| InstallationError::ExecutableInvalid)?;
    if platform_path_string(plan.platform(), &canonical)? != plan.bridge_path() {
        return Err(InstallationError::InvalidPath);
    }
    let metadata = fs::metadata(path).map_err(|_| InstallationError::ExecutableInvalid)?;
    if !metadata.is_file() {
        return Err(InstallationError::ExecutableInvalid);
    }
    #[cfg(unix)]
    if !path.starts_with(plan.user_root()) {
        return Err(InstallationError::InvalidPath);
    }
    validate_secure_metadata(plan, &metadata)
}

pub(super) fn prepare_directory(
    plan: &InstallationPlan,
    path: &Path,
) -> Result<(), InstallationError> {
    validate_root(plan)?;
    #[cfg(unix)]
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|_| InstallationError::Filesystem)?;
    #[cfg(not(unix))]
    fs::create_dir_all(path).map_err(|_| InstallationError::Filesystem)?;

    validate_existing_directory(plan, path)
}

pub(super) fn ensure_absent(path: &Path) -> Result<(), InstallationError> {
    if path_exists(path)? {
        Err(InstallationError::Filesystem)
    } else {
        Ok(())
    }
}

pub(super) fn platform_path_string(
    platform: HostPlatform,
    path: &Path,
) -> Result<String, InstallationError> {
    let value = path.to_str().ok_or(InstallationError::InvalidPath)?;
    if platform == HostPlatform::Windows {
        Ok(value.strip_prefix(r"\\?\").unwrap_or(value).to_owned())
    } else {
        Ok(value.to_owned())
    }
}

fn validate_owned_regular_file(
    plan: &InstallationPlan,
    path: &Path,
) -> Result<(), InstallationError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| InstallationError::Filesystem)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(InstallationError::UnsafePermissions);
    }
    validate_secure_metadata(plan, &metadata)
}

fn validate_root(plan: &InstallationPlan) -> Result<(), InstallationError> {
    let root = Path::new(plan.user_root());
    let canonical =
        fs::canonicalize(root).map_err(|_| InstallationError::EnvironmentUnavailable)?;
    if platform_path_string(plan.platform(), &canonical)? != plan.user_root() {
        return Err(InstallationError::InvalidPath);
    }
    let metadata =
        fs::symlink_metadata(root).map_err(|_| InstallationError::EnvironmentUnavailable)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(InstallationError::UnsafePermissions);
    }
    Ok(())
}

fn validate_existing_directory(
    plan: &InstallationPlan,
    path: &Path,
) -> Result<(), InstallationError> {
    validate_root(plan)?;
    let canonical = fs::canonicalize(path).map_err(|_| InstallationError::Filesystem)?;
    if platform_path_string(plan.platform(), &canonical)?
        != path.to_str().ok_or(InstallationError::InvalidPath)?
    {
        return Err(InstallationError::InvalidPath);
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| InstallationError::Filesystem)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(InstallationError::UnsafePermissions);
    }
    validate_secure_metadata(plan, &metadata)
}

#[cfg(unix)]
fn validate_secure_metadata(
    plan: &InstallationPlan,
    metadata: &fs::Metadata,
) -> Result<(), InstallationError> {
    let root =
        fs::metadata(plan.user_root()).map_err(|_| InstallationError::EnvironmentUnavailable)?;
    if metadata.uid() != root.uid() || metadata.permissions().mode() & 0o022 != 0 {
        return Err(InstallationError::UnsafePermissions);
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_secure_metadata(
    _plan: &InstallationPlan,
    _metadata: &fs::Metadata,
) -> Result<(), InstallationError> {
    Ok(())
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, InstallationError> {
    let metadata = fs::metadata(path).map_err(|_| InstallationError::Filesystem)?;
    if metadata.len() > MAX_METADATA_BYTES {
        return Err(InstallationError::ExistingInstallationNotOwned);
    }
    let capacity = usize::try_from(metadata.len()).map_err(|_| InstallationError::Filesystem)?;
    let mut bytes = Vec::with_capacity(capacity);
    File::open(path)
        .and_then(|file| file.take(MAX_METADATA_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| InstallationError::Filesystem)?;
    if bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err(InstallationError::ExistingInstallationNotOwned);
    }
    Ok(bytes)
}

fn path_exists(path: &Path) -> Result<bool, InstallationError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(_) => Err(InstallationError::Filesystem),
    }
}
