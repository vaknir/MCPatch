use std::ffi::OsString;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Command {
    Help,
    McpStdio,
    Version,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CliError;

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Command, CliError> {
    let args = args.into_iter().collect::<Vec<_>>();
    match args.as_slice() {
        [] => Ok(Command::McpStdio),
        [value] if value == "mcp-stdio" => Ok(Command::McpStdio),
        [value] if value == "--help" || value == "-h" || value == "help" => Ok(Command::Help),
        [value] if value == "--version" || value == "-V" || value == "version" => {
            Ok(Command::Version)
        }
        _ => Err(CliError),
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::{Command, parse};

    #[test]
    fn defaults_to_mcp_stdio() {
        assert_eq!(parse(Vec::new()), Ok(Command::McpStdio));
        assert_eq!(
            parse(vec![OsString::from("mcp-stdio")]),
            Ok(Command::McpStdio)
        );
    }

    #[test]
    fn rejects_unknown_or_extra_arguments() {
        assert!(parse(vec![OsString::from("unknown")]).is_err());
        assert!(parse(vec![OsString::from("mcp-stdio"), OsString::from("extra")]).is_err());
    }
}
