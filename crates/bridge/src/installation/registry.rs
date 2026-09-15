use super::{InstallationError, InstallationPlan};

#[cfg(not(windows))]
pub(super) fn validate_install(
    _plan: &InstallationPlan,
    _files_present: bool,
) -> Result<(), InstallationError> {
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn validate_uninstall(
    _plan: &InstallationPlan,
    _files_present: bool,
) -> Result<(), InstallationError> {
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn is_installed(_plan: &InstallationPlan) -> Result<bool, InstallationError> {
    Ok(true)
}

#[cfg(not(windows))]
pub(super) fn register(_plan: &InstallationPlan) -> Result<(), InstallationError> {
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn unregister(_plan: &InstallationPlan) -> Result<(), InstallationError> {
    Ok(())
}

#[cfg(windows)]
mod windows {
    use std::io::ErrorKind;

    use winreg::{
        RegKey,
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY, KEY_WRITE},
    };

    use super::{InstallationError, InstallationPlan};

    const REGISTRY_VIEWS: [u32; 2] = [KEY_WOW64_32KEY, KEY_WOW64_64KEY];

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum RegistryState {
        Absent,
        Exact,
        Foreign,
    }

    pub(super) fn validate_install(
        plan: &InstallationPlan,
        files_present: bool,
    ) -> Result<(), InstallationError> {
        for view in REGISTRY_VIEWS {
            match inspect(plan, view)? {
                RegistryState::Absent => {}
                RegistryState::Exact if files_present => {}
                RegistryState::Exact | RegistryState::Foreign => {
                    return Err(InstallationError::RegistryConflict);
                }
            }
        }
        Ok(())
    }

    pub(super) fn validate_uninstall(
        plan: &InstallationPlan,
        files_present: bool,
    ) -> Result<(), InstallationError> {
        for view in REGISTRY_VIEWS {
            match inspect(plan, view)? {
                RegistryState::Absent => {}
                RegistryState::Exact if files_present => {}
                RegistryState::Exact | RegistryState::Foreign => {
                    return Err(InstallationError::RegistryConflict);
                }
            }
        }
        Ok(())
    }

    pub(super) fn is_installed(plan: &InstallationPlan) -> Result<bool, InstallationError> {
        REGISTRY_VIEWS
            .into_iter()
            .map(|view| inspect(plan, view))
            .try_fold(true, |all_exact, state| {
                state.map(|state| all_exact && state == RegistryState::Exact)
            })
    }

    pub(super) fn register(plan: &InstallationPlan) -> Result<(), InstallationError> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let key_name = plan.registry_key().ok_or(InstallationError::Registry)?;
        for view in REGISTRY_VIEWS {
            let (key, _) = root
                .create_subkey_with_flags(key_name, KEY_READ | KEY_WRITE | view)
                .map_err(|_| InstallationError::Registry)?;
            key.set_value("", &plan.manifest_path())
                .map_err(|_| InstallationError::Registry)?;
        }
        Ok(())
    }

    pub(super) fn unregister(plan: &InstallationPlan) -> Result<(), InstallationError> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let key_name = plan.registry_key().ok_or(InstallationError::Registry)?;
        for view in REGISTRY_VIEWS {
            if inspect(plan, view)? == RegistryState::Exact {
                root.delete_subkey_with_flags(key_name, view)
                    .map_err(|_| InstallationError::Registry)?;
            }
        }
        Ok(())
    }

    fn inspect(plan: &InstallationPlan, view: u32) -> Result<RegistryState, InstallationError> {
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let key_name = plan.registry_key().ok_or(InstallationError::Registry)?;
        let key = match root.open_subkey_with_flags(key_name, KEY_READ | view) {
            Ok(key) => key,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(RegistryState::Absent),
            Err(_) => return Err(InstallationError::Registry),
        };
        let value: String = match key.get_value("") {
            Ok(value) => value,
            Err(_) => return Ok(RegistryState::Foreign),
        };
        let values = key
            .enum_values()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| InstallationError::Registry)?;
        let has_subkey = match key.enum_keys().next().transpose() {
            Ok(entry) => entry.is_some(),
            Err(_) => return Err(InstallationError::Registry),
        };
        if value == plan.manifest_path()
            && values.len() == 1
            && values[0].0.is_empty()
            && !has_subkey
        {
            Ok(RegistryState::Exact)
        } else {
            Ok(RegistryState::Foreign)
        }
    }
}

#[cfg(windows)]
pub(super) fn validate_install(
    plan: &InstallationPlan,
    files_present: bool,
) -> Result<(), InstallationError> {
    windows::validate_install(plan, files_present)
}

#[cfg(windows)]
pub(super) fn validate_uninstall(
    plan: &InstallationPlan,
    files_present: bool,
) -> Result<(), InstallationError> {
    windows::validate_uninstall(plan, files_present)
}

#[cfg(windows)]
pub(super) fn is_installed(plan: &InstallationPlan) -> Result<bool, InstallationError> {
    windows::is_installed(plan)
}

#[cfg(windows)]
pub(super) fn register(plan: &InstallationPlan) -> Result<(), InstallationError> {
    windows::register(plan)
}

#[cfg(windows)]
pub(super) fn unregister(plan: &InstallationPlan) -> Result<(), InstallationError> {
    windows::unregister(plan)
}
