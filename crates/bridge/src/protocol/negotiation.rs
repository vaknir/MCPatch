use std::collections::HashSet;

use thiserror::Error;

use super::Message;

const MAX_ADVERTISED_VERSIONS: usize = 16;
const MAX_PROTOCOL_VERSION: u32 = i32::MAX as u32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NegotiationCode {
    InvalidVersionSet,
    NoCommonVersion,
    UnexpectedSelectedVersion,
    UnexpectedMessage,
    VersionMismatch,
    NegotiationFailed,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("protocol negotiation failed: {code:?}")]
pub struct NegotiationError {
    pub code: NegotiationCode,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NegotiationPhase {
    AwaitingHello,
    AckPending { protocol_version: u32 },
    Ready { protocol_version: u32 },
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NegotiationEvent {
    SendHelloAck { selected_protocol_version: u32 },
    MessageAccepted,
}

/// Stateful gate for validated messages on the accepting side of an authenticated connection.
#[derive(Clone, Debug)]
pub struct AcceptorNegotiation {
    local_versions: Vec<u32>,
    phase: NegotiationPhase,
}

impl AcceptorNegotiation {
    pub fn new(local_versions: Vec<u32>) -> Result<Self, NegotiationError> {
        validate_version_set(&local_versions)?;
        Ok(Self {
            local_versions,
            phase: NegotiationPhase::AwaitingHello,
        })
    }

    pub fn phase(&self) -> NegotiationPhase {
        self.phase
    }

    pub fn receive(&mut self, message: &Message) -> Result<NegotiationEvent, NegotiationError> {
        match self.phase {
            NegotiationPhase::AwaitingHello => {
                let Message::Hello(hello) = message else {
                    return Err(self.fail(NegotiationCode::UnexpectedMessage));
                };
                let selected = match select_protocol_version(
                    &self.local_versions,
                    &hello.supported_protocol_versions,
                ) {
                    Ok(selected) => selected,
                    Err(error) => {
                        self.phase = NegotiationPhase::Failed;
                        return Err(error);
                    }
                };
                self.phase = NegotiationPhase::AckPending {
                    protocol_version: selected,
                };
                Ok(NegotiationEvent::SendHelloAck {
                    selected_protocol_version: selected,
                })
            }
            NegotiationPhase::AckPending { .. } => {
                Err(self.fail(NegotiationCode::UnexpectedMessage))
            }
            NegotiationPhase::Ready { protocol_version } => {
                if matches!(message, Message::Hello(_) | Message::HelloAck(_)) {
                    return Err(self.fail(NegotiationCode::UnexpectedMessage));
                }
                if message_protocol_version(message) != protocol_version {
                    return Err(self.fail(NegotiationCode::VersionMismatch));
                }
                Ok(NegotiationEvent::MessageAccepted)
            }
            NegotiationPhase::Failed => Err(negotiation_error(NegotiationCode::NegotiationFailed)),
        }
    }

    /// Mark the generated acknowledgement as delivered to the transport.
    pub fn acknowledgement_sent(&mut self) -> Result<(), NegotiationError> {
        let NegotiationPhase::AckPending { protocol_version } = self.phase else {
            return Err(self.fail(NegotiationCode::UnexpectedMessage));
        };
        self.phase = NegotiationPhase::Ready { protocol_version };
        Ok(())
    }

    fn fail(&mut self, code: NegotiationCode) -> NegotiationError {
        self.phase = NegotiationPhase::Failed;
        negotiation_error(code)
    }
}

/// Select the highest version both peers advertised.
pub fn select_protocol_version(
    local_versions: &[u32],
    remote_versions: &[u32],
) -> Result<u32, NegotiationError> {
    validate_version_set(local_versions)?;
    validate_version_set(remote_versions)?;

    let remote: HashSet<_> = remote_versions.iter().copied().collect();
    local_versions
        .iter()
        .copied()
        .filter(|version| remote.contains(version))
        .max()
        .ok_or_else(|| negotiation_error(NegotiationCode::NoCommonVersion))
}

/// Verify that an acknowledgement selected the highest offered common version.
pub fn verify_selected_version(
    local_versions: &[u32],
    offered_versions: &[u32],
    selected_version: u32,
) -> Result<(), NegotiationError> {
    let expected = select_protocol_version(local_versions, offered_versions)?;
    if selected_version != expected {
        return Err(negotiation_error(
            NegotiationCode::UnexpectedSelectedVersion,
        ));
    }
    Ok(())
}

fn validate_version_set(versions: &[u32]) -> Result<(), NegotiationError> {
    if versions.is_empty() || versions.len() > MAX_ADVERTISED_VERSIONS {
        return Err(negotiation_error(NegotiationCode::InvalidVersionSet));
    }

    let unique: HashSet<_> = versions.iter().copied().collect();
    if unique.len() != versions.len()
        || versions
            .iter()
            .any(|version| *version == 0 || *version > MAX_PROTOCOL_VERSION)
    {
        return Err(negotiation_error(NegotiationCode::InvalidVersionSet));
    }
    Ok(())
}

fn message_protocol_version(message: &Message) -> u32 {
    match message {
        Message::Hello(value) => value.protocol_version,
        Message::HelloAck(value) => value.protocol_version,
        Message::CapabilitySnapshot(value) => value.protocol_version,
        Message::ContextClosed(value) => value.protocol_version,
        Message::ToolCall(value) => value.protocol_version,
        Message::ToolResult(value) => value.protocol_version,
        Message::ToolError(value) => value.protocol_version,
        Message::Cancel(value) => value.protocol_version,
        Message::ApprovalRequired(value) => value.protocol_version,
        Message::ApprovalResult(value) => value.protocol_version,
        Message::Heartbeat(value) => value.protocol_version,
        Message::ConnectionError(value) => value.protocol_version,
    }
}

fn negotiation_error(code: NegotiationCode) -> NegotiationError {
    NegotiationError { code }
}
