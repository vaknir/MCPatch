use rmcp::{ServiceExt, service::ServerInitializeError};
use thiserror::Error;
use tokio::task::JoinError;
use tokio_util::sync::CancellationToken;

use super::{BridgeMcpServer, bounded_stdio};

#[derive(Debug, Error)]
pub enum BridgeRuntimeError {
    #[error("MCP transport initialization failed")]
    Initialization(#[source] Box<ServerInitializeError>),
    #[error("MCP service task failed")]
    ServiceTask(#[source] JoinError),
}

impl BridgeRuntimeError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Initialization(_) => "mcp_initialization_failed",
            Self::ServiceTask(_) => "mcp_service_task_failed",
        }
    }
}

pub async fn run_stdio() -> Result<(), BridgeRuntimeError> {
    let cancellation = CancellationToken::new();
    let shutdown_task = tokio::spawn(cancel_on_shutdown_signal(cancellation.clone()));

    tracing::info!(target: "mcpatch", event = "mcp_stdio_starting");
    let running = match BridgeMcpServer
        .serve_with_ct(bounded_stdio(), cancellation)
        .await
    {
        Ok(running) => running,
        Err(ServerInitializeError::Cancelled | ServerInitializeError::ConnectionClosed(_)) => {
            stop_signal_task(shutdown_task).await;
            tracing::info!(target: "mcpatch", event = "mcp_stdio_stopped");
            return Ok(());
        }
        Err(error) => {
            stop_signal_task(shutdown_task).await;
            return Err(BridgeRuntimeError::Initialization(Box::new(error)));
        }
    };

    tracing::info!(target: "mcpatch", event = "mcp_client_ready");
    let result = running
        .waiting()
        .await
        .map(|_| ())
        .map_err(BridgeRuntimeError::ServiceTask);
    stop_signal_task(shutdown_task).await;
    tracing::info!(target: "mcpatch", event = "mcp_stdio_stopped");
    result
}

async fn cancel_on_shutdown_signal(cancellation: CancellationToken) {
    match tokio::signal::ctrl_c().await {
        Ok(()) => {
            tracing::info!(target: "mcpatch", event = "shutdown_requested");
            cancellation.cancel();
        }
        Err(_) => {
            tracing::warn!(target: "mcpatch", event = "shutdown_listener_failed");
        }
    }
}

async fn stop_signal_task(task: tokio::task::JoinHandle<()>) {
    task.abort();
    let _ = task.await;
}
