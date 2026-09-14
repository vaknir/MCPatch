#![forbid(unsafe_code)]

use std::{env, process::ExitCode};

use mcpatch_bridge::{
    PRODUCT_VERSION,
    cli::{self, Command},
    logging, mcp,
};

#[tokio::main]
async fn main() -> ExitCode {
    let command = match cli::parse(env::args_os().skip(1)) {
        Ok(command) => command,
        Err(_) => {
            eprintln!("invalid command; run 'mcpatch --help'");
            return ExitCode::from(2);
        }
    };

    match command {
        Command::Help => {
            println!("MCPatch {PRODUCT_VERSION}\n\nUsage: mcpatch [mcp-stdio|--help|--version]");
            ExitCode::SUCCESS
        }
        Command::Version => {
            println!("mcpatch {PRODUCT_VERSION}");
            ExitCode::SUCCESS
        }
        Command::McpStdio => run_mcp_stdio().await,
    }
}

async fn run_mcp_stdio() -> ExitCode {
    if logging::initialize().is_err() {
        eprintln!("MCPatch could not initialize structured logging");
        return ExitCode::FAILURE;
    }

    match mcp::run_stdio().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(target: "mcpatch", event = "bridge_failed", code = error.code());
            ExitCode::FAILURE
        }
    }
}
