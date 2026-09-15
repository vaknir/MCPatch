use std::{env, path::PathBuf};

use super::{CoreProcessSpec, channel_argument};
use crate::local_ipc::InstallChannel;

#[test]
fn launch_spec_uses_only_the_exact_executable_and_fixed_arguments() {
    let executable = PathBuf::from("/trusted/install/mcpatch");

    let development =
        CoreProcessSpec::for_executable(executable.clone(), InstallChannel::Development);
    assert_eq!(development.executable(), executable);
    assert_eq!(
        development.working_directory().unwrap(),
        PathBuf::from("/trusted/install")
    );
    assert_eq!(
        development.arguments(),
        ["bridge-core", "--channel=development"]
    );

    let production =
        CoreProcessSpec::for_executable(executable.clone(), InstallChannel::Production);
    assert_eq!(production.executable(), executable);
    assert_eq!(
        production.arguments(),
        ["bridge-core", "--channel=production"]
    );
}

#[test]
fn install_channels_have_closed_fixed_cli_arguments() {
    assert_eq!(
        channel_argument(InstallChannel::Development),
        "--channel=development"
    );
    assert_eq!(
        channel_argument(InstallChannel::Production),
        "--channel=production"
    );
}

#[test]
fn production_spec_resolves_the_running_process_image() {
    let expected = env::current_exe().unwrap();
    let spec = CoreProcessSpec::current(InstallChannel::Production).unwrap();

    assert!(spec.executable().is_absolute());
    assert_eq!(spec.executable(), expected);
}

#[cfg(unix)]
#[test]
fn spawning_uses_the_exact_executable_without_a_path_search() {
    let spec = CoreProcessSpec::for_executable(
        PathBuf::from("/mcpatch-test/missing/mcpatch"),
        InstallChannel::Development,
    );

    assert!(spec.spawn().is_err());
}
