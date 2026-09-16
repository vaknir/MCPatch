use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistryErrorCode {
    AmbiguousTool,
    /// The registration an approval was bound to was replaced or closed before
    /// dispatch; the human's decision was valid but its target is gone.
    ApprovalContextChanged,
    ApprovalExpired,
    ApprovalMismatch,
    ApprovalNotFound,
    /// The per-site prompt budget is exhausted or the site is in a denial
    /// cooldown; no browser prompt was opened.
    ApprovalRateLimited,
    ApprovalRequired,
    CapabilityDenied,
    ConnectionAlreadyExists,
    ConnectionNotFound,
    DuplicateRequest,
    InvalidArguments,
    InvalidMessage,
    InvalidSchema,
    InternalError,
    LimitExceeded,
    OriginMismatch,
    RequestNotFound,
    ResultInvalid,
    RevisionConflict,
    RouteMismatch,
    StaleRevision,
    ToolNotFound,
    Unauthorized,
}

/// Stable, payload-free registry failure suitable for audit-safe handling.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("capability registry rejected the operation: {code:?}")]
pub struct RegistryError {
    code: RegistryErrorCode,
}

impl RegistryError {
    pub const fn new(code: RegistryErrorCode) -> Self {
        Self { code }
    }

    pub const fn code(self) -> RegistryErrorCode {
        self.code
    }
}
