use std::ffi::OsString;

use crate::local_ipc::InstallChannel;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Command {
    BridgeCore { channel: InstallChannel },
    Help,
    McpStdio,
    NativeHost { caller_origin: OsString },
    Version,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CliError;

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Command, CliError> {
    let args = args.into_iter().collect::<Vec<_>>();
    match args.as_slice() {
        [] => Ok(Command::McpStdio),
        [value] if value == "bridge-core" => Ok(Command::BridgeCore {
            channel: InstallChannel::Production,
        }),
        [value, channel] if value == "bridge-core" && channel == "--channel=development" => {
            Ok(Command::BridgeCore {
                channel: InstallChannel::Development,
            })
        }
        [value, channel] if value == "bridge-core" && channel == "--channel=production" => {
            Ok(Command::BridgeCore {
                channel: InstallChannel::Production,
            })
        }
        [value] if value == "mcp-stdio" => Ok(Command::McpStdio),
        [value, caller_origin] if value == "native-host" => Ok(Command::NativeHost {
            caller_origin: caller_origin.clone(),
        }),
        [value, caller_origin, parent_window]
            if value == "native-host" && valid_parent_window(parent_window) =>
        {
            Ok(Command::NativeHost {
                caller_origin: caller_origin.clone(),
            })
        }
        [value] if value == "--help" || value == "-h" || value == "help" => Ok(Command::Help),
        [value] if value == "--version" || value == "-V" || value == "version" => {
            Ok(Command::Version)
        }
        _ => Err(CliError),
    }
}

fn valid_parent_window(value: &OsString) -> bool {
    value
        .to_str()
        .and_then(|value| value.strip_prefix("--parent-window="))
        .is_some_and(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::{Command, InstallChannel, parse};

    #[test]
    fn defaults_to_mcp_stdio() {
        assert_eq!(parse(Vec::new()), Ok(Command::McpStdio));
        assert_eq!(
            parse(vec![OsString::from("mcp-stdio")]),
            Ok(Command::McpStdio)
        );
    }

    #[test]
    fn parses_internal_bridge_core_channel() {
        assert_eq!(
            parse(vec![OsString::from("bridge-core")]),
            Ok(Command::BridgeCore {
                channel: InstallChannel::Production,
            })
        );
        assert_eq!(
            parse(vec![
                OsString::from("bridge-core"),
                OsString::from("--channel=development"),
            ]),
            Ok(Command::BridgeCore {
                channel: InstallChannel::Development,
            })
        );
        assert!(
            parse(vec![
                OsString::from("bridge-core"),
                OsString::from("--channel=preview"),
            ])
            .is_err()
        );
    }

    #[test]
    fn rejects_unknown_or_extra_arguments() {
        assert!(parse(vec![OsString::from("unknown")]).is_err());
        assert!(parse(vec![OsString::from("mcp-stdio"), OsString::from("extra")]).is_err());
    }

    #[test]
    fn parses_native_host_arguments_from_chromium() {
        let origin = OsString::from("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/");
        assert_eq!(
            parse(vec![OsString::from("native-host"), origin.clone()]),
            Ok(Command::NativeHost {
                caller_origin: origin.clone(),
            })
        );
        assert_eq!(
            parse(vec![
                OsString::from("native-host"),
                origin.clone(),
                OsString::from("--parent-window=42"),
            ]),
            Ok(Command::NativeHost {
                caller_origin: origin,
            })
        );
    }

    #[test]
    fn rejects_malformed_native_host_arguments() {
        assert!(parse(vec![OsString::from("native-host")]).is_err());
        assert!(
            parse(vec![
                OsString::from("native-host"),
                OsString::from("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"),
                OsString::from("--parent-window=not-a-number"),
            ])
            .is_err()
        );
    }
}
