use std::time::Duration;

use serde_json::Value;
use sha2::{Digest, Sha256};
use time::{Duration as TimeDuration, OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::{
    RegistryError, RegistryErrorCode, RoutedApproval, ToolInvocation,
    approval_limits::ApprovalLimitKey,
    registry::CapabilityRegistry,
    state::ResolvedCapability,
    types::{ApprovalBinding, ApprovalCompletionError, ApprovalGrant, PendingApproval},
};
use crate::{
    browser::BrowserConnectionId,
    protocol::{
        ApprovalDecision, ApprovalRequester, ApprovalRequired, ApprovalResult, JsonObject, Message,
        PROTOCOL_VERSION,
    },
};

pub(super) const APPROVAL_POLICY_VERSION: u32 = 1;
const ARGUMENT_HASH_DOMAIN: &[u8] = b"MCPatch approval arguments\0protocol=1\0policy=1\0";
const MAX_APPROVAL_LIFETIME: Duration = Duration::from_secs(5 * 60);
const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 8_192;
const MAX_ARRAY_ITEMS: usize = 512;
const MAX_OBJECT_FIELDS: usize = 256;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const NONCE_ATTEMPTS: usize = 4;

impl CapabilityRegistry {
    pub(super) fn reserve_approval(
        &mut self,
        invocation: ToolInvocation,
        resolved: ResolvedCapability,
        now: OffsetDateTime,
        approval_ttl: Duration,
        requester: ApprovalRequester,
    ) -> Result<RoutedApproval, RegistryError> {
        let ttl = TimeDuration::try_from(approval_ttl)
            .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidMessage))?;
        if approval_ttl.is_zero() || approval_ttl > MAX_APPROVAL_LIFETIME {
            return Err(RegistryError::new(RegistryErrorCode::InvalidMessage));
        }
        let expires_at = now
            .checked_add(ttl)
            .ok_or_else(|| RegistryError::new(RegistryErrorCode::InvalidMessage))?;
        let args_hash = canonical_arguments_hash(&invocation.arguments)?;
        // Budget the prompt before spending a nonce or touching the browser, so
        // a refused request leaves no trace the extension could act on.
        self.approval_limiter
            .admit(
                ApprovalLimitKey::new(resolved.connection.id(), &resolved.origin),
                now,
            )
            .map_err(|_| RegistryError::new(RegistryErrorCode::ApprovalRateLimited))?;
        let approval_id = self.unique_approval_id()?;
        let expires_at_text = expires_at
            .format(&Rfc3339)
            .map_err(|_| RegistryError::new(RegistryErrorCode::InternalError))?;
        // The prompt shows the exact arguments the hash binds. They are the
        // bridge's schema-validated, retained copy — the same values the
        // extension receives in the tool call once the human approves.
        let message = ApprovalRequired {
            protocol_version: PROTOCOL_VERSION,
            approval_id: approval_id.clone(),
            request_id: invocation.request_id.clone(),
            context_id: resolved.context_id.clone(),
            context_revision: resolved.context_revision,
            origin: resolved.origin.clone(),
            tool: invocation.tool.clone(),
            args: invocation.arguments.clone(),
            args_hash: lower_hex(&args_hash),
            expires_at: expires_at_text,
            requester,
        };
        Message::ApprovalRequired(message.clone())
            .validate()
            .map_err(|_| RegistryError::new(RegistryErrorCode::InternalError))?;

        let revocation = CancellationToken::new();
        let (completion, receiver) = oneshot::channel();
        let binding = ApprovalBinding {
            approval_id: approval_id.clone(),
            protocol_version: PROTOCOL_VERSION,
            policy_version: APPROVAL_POLICY_VERSION,
            connection_id: resolved.connection.id().clone(),
            context_id: resolved.context_id,
            context_revision: resolved.context_revision,
            origin: resolved.origin,
            capability: resolved.capability,
            invocation,
            args_hash,
            issued_at: now,
            expires_at,
        };
        self.pending_approvals.insert(
            approval_id,
            PendingApproval {
                binding,
                completion,
                revocation: revocation.clone(),
            },
        );
        Ok(RoutedApproval::new(
            resolved.connection,
            receiver,
            message,
            revocation,
        ))
    }

    pub fn accept_approval_result(
        &mut self,
        connection_id: &BrowserConnectionId,
        result: ApprovalResult,
        now: OffsetDateTime,
    ) -> Result<(), RegistryError> {
        Message::ApprovalResult(result.clone())
            .validate()
            .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidMessage))?;
        let Some(pending) = self.pending_approvals.remove(&result.approval_id) else {
            return Err(RegistryError::new(RegistryErrorCode::ApprovalNotFound));
        };
        pending.revocation.cancel();
        if &pending.binding.connection_id != connection_id
            || pending.binding.approval_id != result.approval_id
            || pending.binding.invocation.request_id != result.request_id
        {
            let _ = pending
                .completion
                .send(Err(ApprovalCompletionError::Revoked));
            return Err(RegistryError::new(RegistryErrorCode::ApprovalMismatch));
        }
        let limit_key =
            ApprovalLimitKey::new(&pending.binding.connection_id, &pending.binding.origin);
        if now < pending.binding.issued_at || now >= pending.binding.expires_at {
            self.approval_limiter.record_outcome(&limit_key, false, now);
            let _ = pending
                .completion
                .send(Err(ApprovalCompletionError::Expired));
            return Err(RegistryError::new(RegistryErrorCode::ApprovalExpired));
        }
        match result.decision {
            ApprovalDecision::Approved => {
                self.approval_limiter.record_outcome(&limit_key, true, now);
                let _ = pending.completion.send(Ok(ApprovalGrant {
                    binding: pending.binding,
                }));
            }
            ApprovalDecision::Denied => {
                self.approval_limiter.record_outcome(&limit_key, false, now);
                let _ = pending
                    .completion
                    .send(Err(ApprovalCompletionError::Denied));
            }
        }
        Ok(())
    }

    pub(super) fn purge_expired_approvals(&mut self, now: OffsetDateTime) {
        let expired = self
            .pending_approvals
            .iter()
            .filter(|(_, approval)| now >= approval.binding.expires_at)
            .map(|(approval_id, _)| approval_id.clone())
            .collect::<Vec<_>>();
        for approval_id in expired {
            if let Some(approval) = self.pending_approvals.remove(&approval_id) {
                let limit_key = ApprovalLimitKey::new(
                    &approval.binding.connection_id,
                    &approval.binding.origin,
                );
                self.approval_limiter.record_outcome(&limit_key, false, now);
                approval.revocation.cancel();
                let _ = approval
                    .completion
                    .send(Err(ApprovalCompletionError::Expired));
            }
        }
    }

    fn unique_approval_id(&self) -> Result<String, RegistryError> {
        for _ in 0..NONCE_ATTEMPTS {
            let mut nonce = [0_u8; 16];
            getrandom::fill(&mut nonce)
                .map_err(|_| RegistryError::new(RegistryErrorCode::InternalError))?;
            let approval_id = format!("approval.{}", lower_hex(&nonce));
            if !self.pending_approvals.contains_key(&approval_id) {
                return Ok(approval_id);
            }
        }
        Err(RegistryError::new(RegistryErrorCode::InternalError))
    }
}

pub(super) fn canonical_arguments_hash(arguments: &JsonObject) -> Result<[u8; 32], RegistryError> {
    let value = Value::Object(arguments.clone());
    let mut nodes = 0;
    validate_jcs_value(&value, 0, &mut nodes)?;
    let canonical = serde_json_canonicalizer::to_vec(&value)
        .map_err(|_| RegistryError::new(RegistryErrorCode::InvalidArguments))?;
    let mut digest = Sha256::new();
    digest.update(ARGUMENT_HASH_DOMAIN);
    digest.update(canonical);
    Ok(digest.finalize().into())
}

fn validate_jcs_value(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), RegistryError> {
    *nodes += 1;
    if depth > MAX_JSON_DEPTH || *nodes > MAX_JSON_NODES {
        return Err(RegistryError::new(RegistryErrorCode::InvalidArguments));
    }
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(()),
        Value::Number(number) => {
            if number
                .as_i64()
                .is_some_and(|value| value.unsigned_abs() > MAX_SAFE_INTEGER)
                || number
                    .as_u64()
                    .is_some_and(|value| value > MAX_SAFE_INTEGER)
            {
                return Err(RegistryError::new(RegistryErrorCode::InvalidArguments));
            }
            Ok(())
        }
        Value::Array(values) => {
            if values.len() > MAX_ARRAY_ITEMS {
                return Err(RegistryError::new(RegistryErrorCode::InvalidArguments));
            }
            for value in values {
                validate_jcs_value(value, depth + 1, nodes)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            if values.len() > MAX_OBJECT_FIELDS {
                return Err(RegistryError::new(RegistryErrorCode::InvalidArguments));
            }
            for value in values.values() {
                validate_jcs_value(value, depth + 1, nodes)?;
            }
            Ok(())
        }
    }
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 0x0f) as usize] as char);
    }
    value
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, Value, json};

    use super::*;

    #[test]
    fn canonical_hash_is_order_independent_domain_separated_and_argument_bound() {
        let mut first = Map::new();
        first.insert("z".to_owned(), json!([3, 2, 1]));
        first.insert("a".to_owned(), json!({"value": 1.0}));
        let mut second = Map::new();
        second.insert("a".to_owned(), json!({"value": 1}));
        second.insert("z".to_owned(), json!([3, 2, 1]));

        let first_hash = canonical_arguments_hash(&first).unwrap();
        let second_hash = canonical_arguments_hash(&second).unwrap();
        assert_eq!(first_hash, second_hash);
        second.insert("z".to_owned(), json!([3, 2, 0]));
        assert_ne!(first_hash, canonical_arguments_hash(&second).unwrap());
        assert_ne!(
            lower_hex(&first_hash),
            lower_hex(&Sha256::digest(
                serde_json_canonicalizer::to_vec(&Value::Object(first)).unwrap()
            ))
        );
    }

    #[test]
    fn canonical_hash_rejects_non_i_json_integers_and_excessive_depth() {
        let unsafe_integer = json!({"value": 9_007_199_254_740_992_u64});
        assert_eq!(
            canonical_arguments_hash(unsafe_integer.as_object().unwrap())
                .unwrap_err()
                .code(),
            RegistryErrorCode::InvalidArguments
        );

        let mut nested = Value::Null;
        for _ in 0..34 {
            nested = json!([nested]);
        }
        let arguments = json!({"nested": nested});
        assert_eq!(
            canonical_arguments_hash(arguments.as_object().unwrap())
                .unwrap_err()
                .code(),
            RegistryErrorCode::InvalidArguments
        );
    }
}
