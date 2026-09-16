use super::{
    BrowserConnectionId,
    session::{BrowserSessionError, BrowserSessionErrorCode, map_connection_error, session_error},
};
use crate::{
    protocol::Message,
    routing::{BrowserToolResponse, RegistryChange, RegistryErrorCode, SharedCapabilityRegistry},
};
use time::OffsetDateTime;

pub(super) enum ReadyMessageAction {
    Continue,
    Heartbeat,
    Close,
}

pub(super) async fn apply_ready_message(
    registry: &SharedCapabilityRegistry,
    connection_id: &BrowserConnectionId,
    message: Message,
) -> Result<ReadyMessageAction, BrowserSessionError> {
    match message {
        Message::Heartbeat(_) => Ok(ReadyMessageAction::Heartbeat),
        Message::ConnectionError(message) if message.fatal => Ok(ReadyMessageAction::Close),
        Message::ConnectionError(_) => Ok(ReadyMessageAction::Continue),
        Message::CapabilitySnapshot(snapshot) => {
            let change = registry
                .lock()
                .await
                .replace_snapshot_at(connection_id, snapshot, OffsetDateTime::now_utc())
                .map_err(|error| match error.code() {
                    RegistryErrorCode::SnapshotRateLimited => {
                        session_error(BrowserSessionErrorCode::SnapshotFlood)
                    }
                    _ => registry_rejected(),
                })?;
            dispatch_cancellations(change).await?;
            Ok(ReadyMessageAction::Continue)
        }
        Message::ContextClosed(closed) => {
            let change = registry
                .lock()
                .await
                .close_context(connection_id, closed)
                .map_err(|_| registry_rejected())?;
            dispatch_cancellations(change).await?;
            Ok(ReadyMessageAction::Continue)
        }
        Message::ToolResult(result) => {
            registry
                .lock()
                .await
                .accept_response(connection_id, BrowserToolResponse::Result(result))
                .map_err(|_| registry_rejected())?;
            Ok(ReadyMessageAction::Continue)
        }
        Message::ToolError(error) => {
            registry
                .lock()
                .await
                .accept_response(connection_id, BrowserToolResponse::Error(error))
                .map_err(|_| registry_rejected())?;
            Ok(ReadyMessageAction::Continue)
        }
        Message::ApprovalResult(result) => {
            registry
                .lock()
                .await
                .accept_approval_result(connection_id, result, OffsetDateTime::now_utc())
                .map_err(|_| registry_rejected())?;
            Ok(ReadyMessageAction::Continue)
        }
        _ => Err(session_error(BrowserSessionErrorCode::ProtocolViolation)),
    }
}

async fn dispatch_cancellations(change: RegistryChange) -> Result<(), BrowserSessionError> {
    for cancellation in change.cancellations {
        cancellation
            .dispatch()
            .await
            .map_err(map_connection_error)?;
    }
    Ok(())
}

const fn registry_rejected() -> BrowserSessionError {
    session_error(BrowserSessionErrorCode::RegistryRejected)
}
