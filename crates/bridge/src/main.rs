#![forbid(unsafe_code)]

use std::{env, ffi::OsString, process::ExitCode, sync::Arc};

use mcpatch_bridge::{
    PRODUCT_VERSION,
    cli::{self, Command},
    logging, mcp,
    native_host::{
        self, ALLOWED_EXTENSION_ORIGIN_ENV, ExactCallerOriginPolicy, UnavailableLocalBrowserChannel,
    },
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
            println!(
                "MCPatch {PRODUCT_VERSION}\n\nUsage: mcpatch [mcp-stdio|native-host <caller-origin> [--parent-window=<handle>]|--help|--version]"
            );
            ExitCode::SUCCESS
        }
        Command::Version => {
            println!("mcpatch {PRODUCT_VERSION}");
            ExitCode::SUCCESS
        }
        Command::McpStdio => run_mcp_stdio().await,
        Command::NativeHost { caller_origin } => run_native_host(caller_origin).await,
    }
}

async fn run_native_host(caller_origin: OsString) -> ExitCode {
    if logging::initialize().is_err() {
        eprintln!("MCPatch could not initialize structured logging");
        return ExitCode::FAILURE;
    }

    let Some(caller_origin) = caller_origin.into_string().ok() else {
        tracing::error!(target: "mcpatch", event = "native_host_failed", code = "caller_origin_invalid");
        return ExitCode::FAILURE;
    };
    let Ok(allowed_origin) = env::var(ALLOWED_EXTENSION_ORIGIN_ENV) else {
        tracing::error!(target: "mcpatch", event = "native_host_failed", code = "caller_origin_policy_unconfigured");
        return ExitCode::FAILURE;
    };
    let Ok(origin_policy) = ExactCallerOriginPolicy::new(allowed_origin) else {
        tracing::error!(target: "mcpatch", event = "native_host_failed", code = "caller_origin_policy_invalid");
        return ExitCode::FAILURE;
    };

    tracing::info!(target: "mcpatch", event = "native_host_started");
    let result = native_host::run(
        caller_origin,
        tokio::io::stdin(),
        tokio::io::stdout(),
        origin_policy,
        Arc::new(UnavailableLocalBrowserChannel),
    )
    .await;
    match result {
        Ok(()) => {
            tracing::info!(target: "mcpatch", event = "native_host_stopped");
            ExitCode::SUCCESS
        }
        Err(error) => {
            tracing::error!(target: "mcpatch", event = "native_host_failed", code = error.code());
            ExitCode::FAILURE
        }
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
