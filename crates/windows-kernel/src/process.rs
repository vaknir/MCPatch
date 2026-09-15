use std::{io, os::windows::ffi::OsStrExt, path::Path};

use firehazard::process::{
    CREATE_NEW_PROCESS_GROUP, CreationFlags, DETACHED_PROCESS, StartupInfoW, environment::Inherit,
};
use widestring::U16CString;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BridgeCoreChannel {
    Development,
    Production,
}

/// Spawn an exact executable as a detached MCPatch bridge core.
///
/// The command line contains only fixed MCPatch arguments. No handles or standard
/// streams are inherited, and the returned process and thread handles are closed
/// immediately.
pub fn spawn_bridge_core(executable: &Path, channel: BridgeCoreChannel) -> io::Result<()> {
    let application = U16CString::from_os_str(executable).map_err(invalid_executable)?;
    let working_directory = executable
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(invalid_installation_directory)?;
    let working_directory =
        U16CString::from_os_str(working_directory).map_err(invalid_executable)?;
    let mut command_line = command_line(executable, channel)?;
    let (inherit_handles, creation_flags, startup) = launch_configuration();
    let information = firehazard::create_process_w(
        application.as_ucstr(),
        Some(&mut command_line),
        None,
        None,
        inherit_handles,
        creation_flags,
        Inherit,
        working_directory.as_ucstr(),
        &startup,
    )
    .map_err(|error| io::Error::from_raw_os_error(i32::from(error)))?;

    drop(information);
    Ok(())
}

fn launch_configuration() -> (bool, CreationFlags, StartupInfoW<'static>) {
    (
        false,
        DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        StartupInfoW::default(),
    )
}

fn command_line(executable: &Path, channel: BridgeCoreChannel) -> io::Result<Vec<u16>> {
    let executable = executable.as_os_str().encode_wide().collect::<Vec<_>>();
    if executable.is_empty() || executable.contains(&0) || executable.contains(&(b'"' as u16)) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "bridge executable path is invalid",
        ));
    }

    let argument = match channel {
        BridgeCoreChannel::Development => " bridge-core --channel=development",
        BridgeCoreChannel::Production => " bridge-core --channel=production",
    };
    let mut value = Vec::with_capacity(executable.len() + argument.len() + 3);
    value.push(b'"' as u16);
    value.extend(executable);
    value.push(b'"' as u16);
    value.extend(argument.encode_utf16());
    value.push(0);
    Ok(value)
}

fn invalid_executable(_: widestring::error::ContainsNul<u16>) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "bridge executable path is invalid",
    )
}

fn invalid_installation_directory() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "bridge executable has no installation directory",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_line_quotes_the_exact_executable_and_uses_fixed_arguments() {
        let executable = Path::new(r"C:\Program Files\MCPatch\mcpatch.exe");

        let development =
            String::from_utf16(&command_line(executable, BridgeCoreChannel::Development).unwrap())
                .unwrap();
        assert_eq!(
            development,
            "\"C:\\Program Files\\MCPatch\\mcpatch.exe\" bridge-core --channel=development\0"
        );

        let production =
            String::from_utf16(&command_line(executable, BridgeCoreChannel::Production).unwrap())
                .unwrap();
        assert_eq!(
            production,
            "\"C:\\Program Files\\MCPatch\\mcpatch.exe\" bridge-core --channel=production\0"
        );
    }

    #[test]
    fn launch_configuration_disables_inheritance_and_detaches_the_process() {
        let (inherit_handles, creation_flags, startup) = launch_configuration();

        assert!(!inherit_handles);
        assert_eq!(creation_flags, DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        assert_eq!(startup.flags, 0);
        assert!(startup.std_input.is_none());
        assert!(startup.std_output.is_none());
        assert!(startup.std_error.is_none());
    }

    #[test]
    fn missing_exact_executable_fails_without_a_path_search() {
        assert!(
            spawn_bridge_core(
                Path::new(r"Z:\mcpatch-test\missing\mcpatch.exe"),
                BridgeCoreChannel::Development,
            )
            .is_err()
        );
    }
}
