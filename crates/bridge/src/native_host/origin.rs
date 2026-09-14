use thiserror::Error;

const EXTENSION_ORIGIN_PREFIX: &str = "chrome-extension://";
const EXTENSION_ID_BYTES: usize = 32;

/// A canonical Chromium extension origin.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionOrigin(String);

impl ExtensionOrigin {
    /// Parse the exact origin form passed to Native Messaging hosts by Chromium.
    pub fn parse(value: impl Into<String>) -> Result<Self, CallerOriginError> {
        let value = value.into();
        let Some(extension_id) = value
            .strip_prefix(EXTENSION_ORIGIN_PREFIX)
            .and_then(|remainder| remainder.strip_suffix('/'))
        else {
            return Err(CallerOriginError::Invalid);
        };

        if extension_id.len() != EXTENSION_ID_BYTES
            || !extension_id.bytes().all(|byte| matches!(byte, b'a'..=b'p'))
        {
            return Err(CallerOriginError::Invalid);
        }

        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Stable caller-origin failure categories.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum CallerOriginError {
    #[error("caller origin is invalid")]
    Invalid,
    #[error("caller origin is unauthorized")]
    Unauthorized,
}

impl CallerOriginError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "caller_origin_invalid",
            Self::Unauthorized => "caller_origin_unauthorized",
        }
    }
}

/// Authorizes the canonical caller origin before any browser frame is read.
pub trait CallerOriginPolicy: Send + Sync {
    fn authorize(&self, origin: &ExtensionOrigin) -> Result<(), CallerOriginError>;
}

/// A fail-closed policy allowing exactly one extension identity.
#[derive(Clone, Debug)]
pub struct ExactCallerOriginPolicy {
    allowed: ExtensionOrigin,
}

impl ExactCallerOriginPolicy {
    pub fn new(allowed: impl Into<String>) -> Result<Self, CallerOriginError> {
        Ok(Self {
            allowed: ExtensionOrigin::parse(allowed)?,
        })
    }
}

impl CallerOriginPolicy for ExactCallerOriginPolicy {
    fn authorize(&self, origin: &ExtensionOrigin) -> Result<(), CallerOriginError> {
        if origin == &self.allowed {
            Ok(())
        } else {
            Err(CallerOriginError::Unauthorized)
        }
    }
}
