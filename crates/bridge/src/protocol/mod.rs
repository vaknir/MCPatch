mod error;
mod negotiation;
mod strict_json;
mod types;
mod validate;

pub use error::{ParseMessageError, ValidationCode, ValidationError};
pub use negotiation::*;
pub use types::*;

pub(crate) use strict_json::parse_value as parse_strict_json_value;

/// Maximum encoded protocol frame accepted before JSON parsing.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
/// The bridge protocol version implemented by these types.
pub const PROTOCOL_VERSION: u32 = 1;

pub(crate) fn valid_identifier(value: &str, maximum: usize) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= maximum
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

/// Decode and semantically validate one complete protocol message.
pub fn parse_message(input: &[u8]) -> Result<Message, ParseMessageError> {
    if input.len() > MAX_MESSAGE_BYTES {
        return Err(ParseMessageError::MessageTooLarge {
            actual: input.len(),
            maximum: MAX_MESSAGE_BYTES,
        });
    }

    let value = strict_json::parse_value(input)?;
    let message: Message = serde_json::from_value(value)?;
    message.validate()?;
    Ok(message)
}
