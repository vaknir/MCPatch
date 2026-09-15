use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use super::{InstallationError, InstallationPlan, ensure_absent, prepare_directory};

pub(super) struct BackupPaths {
    pub(super) manifest: String,
    pub(super) receipt: String,
}

pub(super) fn install_files(
    plan: &InstallationPlan,
    replacing: bool,
) -> Result<(), InstallationError> {
    let parent = Path::new(plan.manifest_path())
        .parent()
        .ok_or(InstallationError::InvalidPath)?;
    prepare_directory(plan, parent)?;

    let suffix = random_suffix()?;
    let staged_manifest = parent.join(format!(".mcpatch-manifest-stage-{suffix}"));
    let staged_receipt = parent.join(format!(".mcpatch-receipt-stage-{suffix}"));
    write_new(&staged_manifest, plan.manifest_json())?;
    if let Err(error) = write_new(&staged_receipt, plan.receipt_json()) {
        let _ = fs::remove_file(&staged_manifest);
        return Err(error);
    }

    replace_staged_pair(plan, replacing, &suffix, &staged_manifest, &staged_receipt)
}

pub(super) fn backup_files(plan: &InstallationPlan) -> Result<BackupPaths, InstallationError> {
    let suffix = random_suffix()?;
    let backups = BackupPaths {
        manifest: format!("{}.mcpatch-backup-{suffix}", plan.manifest_path()),
        receipt: format!("{}.mcpatch-backup-{suffix}", plan.receipt_path()),
    };
    ensure_absent(Path::new(&backups.manifest))?;
    ensure_absent(Path::new(&backups.receipt))?;

    fs::rename(plan.manifest_path(), &backups.manifest)
        .map_err(|_| InstallationError::Filesystem)?;
    if fs::rename(plan.receipt_path(), &backups.receipt).is_err() {
        let _ = fs::rename(&backups.manifest, plan.manifest_path());
        return Err(InstallationError::Filesystem);
    }
    Ok(backups)
}

pub(super) fn restore_backups(plan: &InstallationPlan, backups: &BackupPaths) {
    let _ = fs::rename(&backups.receipt, plan.receipt_path());
    let _ = fs::rename(&backups.manifest, plan.manifest_path());
}

fn replace_staged_pair(
    plan: &InstallationPlan,
    replacing: bool,
    suffix: &str,
    staged_manifest: &Path,
    staged_receipt: &Path,
) -> Result<(), InstallationError> {
    let parent = staged_manifest
        .parent()
        .ok_or(InstallationError::InvalidPath)?;
    let rollback_manifest = parent.join(format!(".mcpatch-manifest-rollback-{suffix}"));
    let rollback_receipt = parent.join(format!(".mcpatch-receipt-rollback-{suffix}"));
    if let Err(error) =
        move_existing_to_rollback(plan, replacing, &rollback_manifest, &rollback_receipt)
    {
        cleanup_staged(staged_manifest, staged_receipt);
        return Err(error);
    }

    if fs::rename(staged_receipt, plan.receipt_path()).is_err() {
        restore_previous(plan, replacing, &rollback_manifest, &rollback_receipt);
        let _ = fs::remove_file(staged_manifest);
        return Err(InstallationError::Filesystem);
    }
    if fs::rename(staged_manifest, plan.manifest_path()).is_err() {
        let _ = fs::remove_file(plan.receipt_path());
        restore_previous(plan, replacing, &rollback_manifest, &rollback_receipt);
        let _ = fs::remove_file(staged_manifest);
        return Err(InstallationError::Filesystem);
    }
    remove_rollback(replacing, rollback_manifest, rollback_receipt)
}

fn move_existing_to_rollback(
    plan: &InstallationPlan,
    replacing: bool,
    rollback_manifest: &Path,
    rollback_receipt: &Path,
) -> Result<(), InstallationError> {
    if !replacing {
        return Ok(());
    }
    if fs::rename(plan.manifest_path(), rollback_manifest).is_err() {
        return Err(InstallationError::Filesystem);
    }
    if fs::rename(plan.receipt_path(), rollback_receipt).is_err() {
        let _ = fs::rename(rollback_manifest, plan.manifest_path());
        return Err(InstallationError::Filesystem);
    }
    Ok(())
}

fn restore_previous(
    plan: &InstallationPlan,
    replacing: bool,
    rollback_manifest: &Path,
    rollback_receipt: &Path,
) {
    if replacing {
        let _ = fs::rename(rollback_manifest, plan.manifest_path());
        let _ = fs::rename(rollback_receipt, plan.receipt_path());
    }
}

fn remove_rollback(
    replacing: bool,
    rollback_manifest: PathBuf,
    rollback_receipt: PathBuf,
) -> Result<(), InstallationError> {
    if replacing {
        fs::remove_file(rollback_manifest).map_err(|_| InstallationError::Filesystem)?;
        fs::remove_file(rollback_receipt).map_err(|_| InstallationError::Filesystem)?;
    }
    Ok(())
}

fn cleanup_staged(manifest: &Path, receipt: &Path) {
    let _ = fs::remove_file(manifest);
    let _ = fs::remove_file(receipt);
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), InstallationError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|_| InstallationError::Filesystem)?;
    file.write_all(bytes)
        .map_err(|_| InstallationError::Filesystem)?;
    file.sync_all().map_err(|_| InstallationError::Filesystem)
}

fn random_suffix() -> Result<String, InstallationError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| InstallationError::Entropy)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
