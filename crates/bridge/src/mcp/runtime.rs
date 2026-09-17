use std::future::Future;

use thiserror::Error;
use tokio::io::{AsyncRead, AsyncWrite};

use super::{BoundedMcpInput, McpStdioFrameError, write_json_line};
use crate::local_ipc::{
    CoreRendezvousError, EndpointRole, InstallChannel, LocalCoreConnection,
    LocalCoreConnectionError, connect_or_start_core,
};

#[derive(Debug, Error)]
pub enum BridgeRuntimeError {
    #[error("bridge-core rendezvous failed")]
    Rendezvous(#[source] CoreRendezvousError),
    #[error("local MCP connection failed")]
    LocalConnection(#[source] LocalCoreConnectionError),
    #[error("MCP stdio framing failed")]
    Stdio(#[source] McpStdioFrameError),
}

impl BridgeRuntimeError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Rendezvous(error) => error.code().as_str(),
            Self::LocalConnection(error) => error.code().as_str(),
            Self::Stdio(error) => error.code().as_str(),
        }
    }

    /// Fixed, path-free guidance for failures an operator can correct.
    pub const fn operator_hint(&self) -> Option<&'static str> {
        match self {
            Self::Rendezvous(error) => error.code().operator_hint(),
            Self::LocalConnection(error) => error.code().operator_hint(),
            Self::Stdio(_) => None,
        }
    }
}

pub async fn run_stdio() -> Result<(), BridgeRuntimeError> {
    tracing::info!(target: "mcpatch", event = "mcp_stdio_starting");
    let result = run(tokio::io::stdin(), tokio::io::stdout(), || {
        connect_or_start_core(InstallChannel::Production, EndpointRole::Mcp)
    })
    .await;
    tracing::info!(target: "mcpatch", event = "mcp_stdio_stopped");
    result
}

pub async fn run<R, W, C, F>(input: R, output: W, connect: C) -> Result<(), BridgeRuntimeError>
where
    R: AsyncRead + Send + Unpin,
    W: AsyncWrite + Send + Unpin,
    C: FnOnce() -> F,
    F: Future<Output = Result<LocalCoreConnection, CoreRendezvousError>>,
{
    let mut input = BoundedMcpInput::new(input);
    let Some(first_message) = input
        .receive_json()
        .await
        .map_err(BridgeRuntimeError::Stdio)?
    else {
        return Ok(());
    };

    let connection = connect().await.map_err(BridgeRuntimeError::Rendezvous)?;
    relay(first_message, input, output, connection).await
}

async fn relay<R, W>(
    first_message: Vec<u8>,
    input: BoundedMcpInput<R>,
    output: W,
    connection: LocalCoreConnection,
) -> Result<(), BridgeRuntimeError>
where
    R: AsyncRead + Send + Unpin,
    W: AsyncWrite + Send + Unpin,
{
    let (receiver, sender) = connection.into_split();
    let inbound = pump_inbound(first_message, input, sender);
    let outbound = pump_outbound(receiver, output);
    tokio::pin!(inbound, outbound);

    tokio::select! {
        result = &mut inbound => result,
        result = &mut outbound => result,
    }
}

async fn pump_inbound<R>(
    first_message: Vec<u8>,
    mut input: BoundedMcpInput<R>,
    mut sender: crate::local_ipc::LocalCoreSender,
) -> Result<(), BridgeRuntimeError>
where
    R: AsyncRead + Unpin,
{
    sender
        .send_json(&first_message)
        .await
        .map_err(BridgeRuntimeError::LocalConnection)?;
    while let Some(message) = input
        .receive_json()
        .await
        .map_err(BridgeRuntimeError::Stdio)?
    {
        sender
            .send_json(&message)
            .await
            .map_err(BridgeRuntimeError::LocalConnection)?;
    }
    Ok(())
}

async fn pump_outbound<W>(
    mut receiver: crate::local_ipc::LocalCoreReceiver,
    mut output: W,
) -> Result<(), BridgeRuntimeError>
where
    W: AsyncWrite + Unpin,
{
    while let Some(message) = receiver
        .receive_json()
        .await
        .map_err(BridgeRuntimeError::LocalConnection)?
    {
        write_json_line(&mut output, &message)
            .await
            .map_err(BridgeRuntimeError::Stdio)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use tokio::io::AsyncWriteExt;

    use super::*;

    #[tokio::test]
    async fn clean_initial_eof_does_not_attempt_rendezvous() {
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&calls);
        run(tokio::io::empty(), tokio::io::sink(), move || {
            observed.fetch_add(1, Ordering::AcqRel);
            async { Err(CoreRendezvousError::Timeout) }
        })
        .await
        .unwrap();
        assert_eq!(calls.load(Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn first_valid_frame_triggers_one_bounded_rendezvous() {
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&calls);
        let (mut client, input) = tokio::io::duplex(128);
        client.write_all(b"{}\n").await.unwrap();

        let error = run(input, tokio::io::sink(), move || {
            observed.fetch_add(1, Ordering::AcqRel);
            async { Err(CoreRendezvousError::Timeout) }
        })
        .await
        .unwrap_err();
        assert_eq!(error.code(), "core_startup_timeout");
        assert_eq!(calls.load(Ordering::Acquire), 1);
    }
}
