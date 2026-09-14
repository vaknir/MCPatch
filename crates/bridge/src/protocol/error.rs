use thiserror::Error;

/// Stable categories for validation failures at the bridge trust boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ValidationCode {
    UnsupportedVersion,
    InvalidIdentifier,
    InvalidOrigin,
    InvalidValue,
    InvalidSchema,
    InvalidCapability,
    LimitExceeded,
}

/// A semantic protocol validation failure.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("{code:?} at {field}")]
pub struct ValidationError {
    pub code: ValidationCode,
    pub field: String,
}

impl ValidationError {
    pub(crate) fn new(code: ValidationCode, field: impl Into<String>) -> Self {
        Self {
            code,
            field: field.into(),
        }
    }
}

/// A failure while decoding a complete protocol frame.
#[derive(Debug, Error)]
pub enum ParseMessageError {
    #[error("message is {actual} bytes; maximum is {maximum}")]
    MessageTooLarge { actual: usize, maximum: usize },
    #[error("message is not valid protocol JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("message failed semantic validation: {0}")]
    Validation(#[from] ValidationError),
}
