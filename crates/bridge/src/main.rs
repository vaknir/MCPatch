#![forbid(unsafe_code)]

use std::{env, ffi::OsString, process::ExitCode, sync::Arc};

use mcpatch_bridge::{
    PRODUCT_VERSION,
    cli::{self, Command},
    local_ipc::InstallChannel,
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
                "MCPatch {PRODUCT_VERSION}\n\nUsage: mcpatch [mcp-stdio|native-host <caller-origin> [--parent-window=<handle>]|bridge-core [--channel=development|--channel=production]|--help|--version]"
            );
            ExitCode::SUCCESS
        }
        Command::Version => {
            println!("mcpatch {PRODUCT_VERSION}");
            ExitCode::SUCCESS
        }
        Command::McpStdio => run_mcp_stdio().await,
        Command::NativeHost { caller_origin } => run_native_host(caller_origin).await,
        Command::BridgeCore { channel } => run_bridge_core(channel).await,
    }
}

async fn run_bridge_core(channel: InstallChannel) -> ExitCode {
    if logging::initialize().is_err() {
        eprintln!("MCPatch could not initialize structured logging");
        return ExitCode::FAILURE;
    }

    #[cfg(unix)]
    {
        use mcpatch_bridge::{
            bridge_core::{DEFAULT_IDLE_TIMEOUT, UnixBridgeCore},
            local_ipc::UnixRuntime,
        };
        use tokio_util::sync::CancellationToken;

        let runtime = match UnixRuntime::prepare(channel).await {
            Ok(runtime) => runtime,
            Err(_) => {
                tracing::error!(target: "mcpatch", event = "bridge_core_failed", code = "core_transport_failed");
                return ExitCode::FAILURE;
            }
        };
        let core = match UnixBridgeCore::start(runtime).await {
            Ok(core) => core,
            Err(error) => {
                tracing::error!(target: "mcpatch", event = "bridge_core_failed", code = error.code());
                return ExitCode::FAILURE;
            }
        };
        let shutdown = CancellationToken::new();
        let shutdown_task = tokio::spawn(cancel_core_on_shutdown_signal(shutdown.clone()));

        tracing::info!(target: "mcpatch", event = "bridge_core_started");
        let result = core.run(DEFAULT_IDLE_TIMEOUT, shutdown).await;
        shutdown_task.abort();
        let _ = shutdown_task.await;

        match result {
            Ok(reason) => {
                tracing::info!(target: "mcpatch", event = "bridge_core_stopped", reason = ?reason);
                ExitCode::SUCCESS
            }
            Err(error) => {
                tracing::error!(target: "mcpatch", event = "bridge_core_failed", code = error.code());
                ExitCode::FAILURE
            }
        }
    }

    #[cfg(not(unix))]
    {
        let _ = channel;
        tracing::error!(target: "mcpatch", event = "bridge_core_failed", code = "core_transport_unavailable");
        ExitCode::FAILURE
    }
}

#[cfg(unix)]
async fn cancel_core_on_shutdown_signal(shutdown: tokio_util::sync::CancellationToken) {
    match tokio::signal::ctrl_c().await {
        Ok(()) => {
            tracing::info!(target: "mcpatch", event = "shutdown_requested");
            shutdown.cancel();
        }
        Err(_) => {
            tracing::warn!(target: "mcpatch", event = "shutdown_listener_failed");
        }
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
