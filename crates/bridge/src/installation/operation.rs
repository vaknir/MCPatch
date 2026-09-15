use super::{
    ExistingFiles, HostPlatform, InstallationError, InstallationPlan, backup_files, inspect_files,
    install_files, registry, restore_backups, validate_bridge,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstallStatus {
    AlreadyInstalled,
    Installed,
    Updated,
    WouldInstall,
    WouldUpdate,
}

impl InstallStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AlreadyInstalled => "already_installed",
            Self::Installed => "installed",
            Self::Updated => "updated",
            Self::WouldInstall => "would_install",
            Self::WouldUpdate => "would_update",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UninstallStatus {
    AlreadyAbsent,
    Uninstalled,
    WouldUninstall,
}

impl UninstallStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AlreadyAbsent => "already_absent",
            Self::Uninstalled => "uninstalled",
            Self::WouldUninstall => "would_uninstall",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstallOutcome {
    pub status: InstallStatus,
    pub manifest_path: String,
    pub registry_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UninstallOutcome {
    pub status: UninstallStatus,
    pub manifest_path: String,
    pub registry_key: Option<String>,
    pub backup_manifest_path: Option<String>,
    pub backup_receipt_path: Option<String>,
}

pub fn install_plan(
    plan: &InstallationPlan,
    dry_run: bool,
) -> Result<InstallOutcome, InstallationError> {
    require_current_platform(plan)?;
    validate_bridge(plan)?;
    let state = inspect_files(plan)?;
    registry::validate_install(plan, state.is_present())?;

    let registry_installed = registry::is_installed(plan)?;
    if dry_run {
        return Ok(install_outcome(
            plan,
            preview_install_status(state, registry_installed),
        ));
    }

    let status = match state {
        ExistingFiles::Owned { exact: true } if registry_installed => {
            InstallStatus::AlreadyInstalled
        }
        ExistingFiles::Absent => {
            install_files(plan, false)?;
            registry::register(plan)?;
            InstallStatus::Installed
        }
        ExistingFiles::Owned { exact: true } => {
            registry::register(plan)?;
            InstallStatus::Updated
        }
        ExistingFiles::Owned { exact: false } => {
            install_files(plan, true)?;
            registry::register(plan)?;
            InstallStatus::Updated
        }
    };
    Ok(install_outcome(plan, status))
}

pub fn uninstall_plan(
    plan: &InstallationPlan,
    dry_run: bool,
) -> Result<UninstallOutcome, InstallationError> {
    require_current_platform(plan)?;
    let state = inspect_files(plan)?;
    registry::validate_uninstall(plan, state.is_present())?;

    if state == ExistingFiles::Absent {
        return Ok(uninstall_outcome(
            plan,
            UninstallStatus::AlreadyAbsent,
            None,
        ));
    }
    if dry_run {
        return Ok(uninstall_outcome(
            plan,
            UninstallStatus::WouldUninstall,
            None,
        ));
    }

    let backups = backup_files(plan)?;
    if let Err(error) = registry::unregister(plan) {
        restore_backups(plan, &backups);
        return Err(error);
    }
    Ok(uninstall_outcome(
        plan,
        UninstallStatus::Uninstalled,
        Some(backups),
    ))
}

fn preview_install_status(state: ExistingFiles, registry_installed: bool) -> InstallStatus {
    match state {
        ExistingFiles::Absent => InstallStatus::WouldInstall,
        ExistingFiles::Owned { exact: true } if registry_installed => {
            InstallStatus::AlreadyInstalled
        }
        ExistingFiles::Owned { .. } => InstallStatus::WouldUpdate,
    }
}

fn install_outcome(plan: &InstallationPlan, status: InstallStatus) -> InstallOutcome {
    InstallOutcome {
        status,
        manifest_path: plan.manifest_path().to_owned(),
        registry_key: plan.registry_key().map(str::to_owned),
    }
}

fn uninstall_outcome(
    plan: &InstallationPlan,
    status: UninstallStatus,
    backups: Option<super::BackupPaths>,
) -> UninstallOutcome {
    UninstallOutcome {
        status,
        manifest_path: plan.manifest_path().to_owned(),
        registry_key: plan.registry_key().map(str::to_owned),
        backup_manifest_path: backups.as_ref().map(|paths| paths.manifest.clone()),
        backup_receipt_path: backups.map(|paths| paths.receipt),
    }
}

fn require_current_platform(plan: &InstallationPlan) -> Result<(), InstallationError> {
    if HostPlatform::current() == Some(plan.platform()) {
        Ok(())
    } else {
        Err(InstallationError::CurrentPlatformUnsupported)
    }
}
