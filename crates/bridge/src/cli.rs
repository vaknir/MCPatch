use std::ffi::OsString;

use crate::{
    installation::ChromiumBrowser, local_ipc::InstallChannel, native_host::ExtensionOrigin,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Command {
    BridgeCore {
        channel: InstallChannel,
    },
    Help,
    Install {
        browser: ChromiumBrowser,
        dry_run: bool,
    },
    McpStdio,
    NativeHost {
        caller_origin: OsString,
    },
    Uninstall {
        browser: ChromiumBrowser,
        dry_run: bool,
    },
    Version,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CliError;

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Command, CliError> {
    let args = args.into_iter().collect::<Vec<_>>();
    if args.first().is_some_and(|value| value == "install") {
        return parse_registration_options(&args[1..], true);
    }
    if args.first().is_some_and(|value| value == "uninstall") {
        return parse_registration_options(&args[1..], false);
    }
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
        [caller_origin] if valid_caller_origin(caller_origin) => Ok(Command::NativeHost {
            caller_origin: caller_origin.clone(),
        }),
        [caller_origin, parent_window]
            if valid_caller_origin(caller_origin) && valid_parent_window(parent_window) =>
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

fn parse_registration_options(args: &[OsString], install: bool) -> Result<Command, CliError> {
    let mut browser = ChromiumBrowser::GoogleChrome;
    let mut browser_seen = false;
    let mut dry_run = false;
    for argument in args {
        let value = argument.to_str().ok_or(CliError)?;
        if value == "--dry-run" && !dry_run {
            dry_run = true;
        } else if let Some(value) = value.strip_prefix("--browser=")
            && !browser_seen
            && let Some(parsed) = ChromiumBrowser::parse(value)
        {
            browser = parsed;
            browser_seen = true;
        } else {
            return Err(CliError);
        }
    }
    if install {
        Ok(Command::Install { browser, dry_run })
    } else {
        Ok(Command::Uninstall { browser, dry_run })
    }
}

fn valid_caller_origin(value: &OsString) -> bool {
    value
        .to_str()
        .is_some_and(|value| ExtensionOrigin::parse(value).is_ok())
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

    use super::{ChromiumBrowser, Command, InstallChannel, parse};

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
    fn parses_closed_install_and_uninstall_options() {
        assert_eq!(
            parse(vec![OsString::from("install")]),
            Ok(Command::Install {
                browser: ChromiumBrowser::GoogleChrome,
                dry_run: false,
            })
        );
        assert_eq!(
            parse(vec![
                OsString::from("install"),
                OsString::from("--browser=chromium"),
                OsString::from("--dry-run"),
            ]),
            Ok(Command::Install {
                browser: ChromiumBrowser::Chromium,
                dry_run: true,
            })
        );
        assert_eq!(
            parse(vec![
                OsString::from("uninstall"),
                OsString::from("--dry-run"),
                OsString::from("--browser=chrome-for-testing"),
            ]),
            Ok(Command::Uninstall {
                browser: ChromiumBrowser::ChromeForTesting,
                dry_run: true,
            })
        );
        for invalid in [
            vec!["install", "--browser=edge"],
            vec!["install", "--dry-run", "--dry-run"],
            vec!["uninstall", "--browser=chromium", "--browser=google-chrome"],
            vec!["uninstall", "--bridge=/tmp/other"],
        ] {
            assert!(parse(invalid.into_iter().map(OsString::from)).is_err());
        }
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
            parse(vec![origin.clone()]),
            Ok(Command::NativeHost {
                caller_origin: origin.clone(),
            })
        );
        assert_eq!(
            parse(vec![origin.clone(), OsString::from("--parent-window=0")]),
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
                caller_origin: origin.clone(),
            })
        );
    }

    #[test]
    fn rejects_malformed_native_host_arguments() {
        assert!(parse(vec![OsString::from("native-host")]).is_err());
        assert!(
            parse(vec![OsString::from(
                "chrome-extension://not-a-valid-extension-id/"
            )])
            .is_err()
        );
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
