use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistryErrorCode {
    AmbiguousTool,
    ApprovalExpired,
    ApprovalMismatch,
    ApprovalNotFound,
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
