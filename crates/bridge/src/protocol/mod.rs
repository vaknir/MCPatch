mod error;
mod strict_json;
mod types;
mod validate;

pub use error::{ParseMessageError, ValidationCode, ValidationError};
pub use types::*;

/// Maximum encoded protocol frame accepted before JSON parsing.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
/// The bridge protocol version implemented by these types.
pub const PROTOCOL_VERSION: u32 = 1;

/// Decode and semantically validate one complete protocol message.
pub fn parse_message(input: &[u8]) -> Result<Message, ParseMessageError> {
    if input.len() > MAX_MESSAGE_BYTES {
        return Err(ParseMessageError::MessageTooLarge {
            actual: input.len(),
            maximum: MAX_MESSAGE_BYTES,
        });
    }

    let strict_json::StrictJson(value) = serde_json::from_slice(input)?;
    let message: Message = serde_json::from_value(value)?;
    message.validate()?;
    Ok(message)
}
