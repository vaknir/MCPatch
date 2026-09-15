use std::{env, fs};

use super::{
    ChromiumBrowser, HostPlatform, InstallOutcome, InstallationError, InstallationPlan,
    UninstallOutcome, build_installation_plan, install_plan, platform_path_string, uninstall_plan,
};

pub fn current_installation_plan(
    browser: ChromiumBrowser,
) -> Result<InstallationPlan, InstallationError> {
    let platform = HostPlatform::current().ok_or(InstallationError::CurrentPlatformUnsupported)?;
    let root_variable = if platform == HostPlatform::Windows {
        "LOCALAPPDATA"
    } else {
        "HOME"
    };
    let user_root = env::var_os(root_variable).ok_or(InstallationError::EnvironmentUnavailable)?;
    let canonical_root =
        fs::canonicalize(&user_root).map_err(|_| InstallationError::EnvironmentUnavailable)?;
    if !fs::metadata(&canonical_root)
        .map_err(|_| InstallationError::EnvironmentUnavailable)?
        .is_dir()
    {
        return Err(InstallationError::EnvironmentUnavailable);
    }
    let executable = env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|_| InstallationError::ExecutableInvalid)?;

    let root = platform_path_string(platform, &canonical_root)?;
    let bridge = platform_path_string(platform, &executable)?;
    build_installation_plan(platform, browser, &root, &bridge)
}

pub fn install_current(
    browser: ChromiumBrowser,
    dry_run: bool,
) -> Result<InstallOutcome, InstallationError> {
    let plan = current_installation_plan(browser)?;
    install_plan(&plan, dry_run)
}

pub fn uninstall_current(
    browser: ChromiumBrowser,
    dry_run: bool,
) -> Result<UninstallOutcome, InstallationError> {
    let plan = current_installation_plan(browser)?;
    uninstall_plan(&plan, dry_run)
}
