use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use url::Url;

use super::invalid;
use crate::protocol::{ValidationCode, ValidationError};

pub(super) fn validate_origin(
    value: &str,
    field: impl Into<String>,
) -> Result<(), ValidationError> {
    let field = field.into();
    let Ok(url) = Url::parse(value) else {
        return Err(invalid(ValidationCode::InvalidOrigin, field));
    };
    let canonical_origin = url.origin().ascii_serialization();
    let valid = url.scheme() == "https"
        && !url.cannot_be_a_base()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
        && value == canonical_origin;
    if !valid {
        return Err(invalid(ValidationCode::InvalidOrigin, field));
    }
    Ok(())
}

pub(super) fn validate_timestamp(value: &str, field: &str) -> Result<(), ValidationError> {
    if value.len() > 35
        || !has_canonical_rfc3339_shape(value)
        || OffsetDateTime::parse(value, &Rfc3339).is_err()
    {
        return Err(invalid(ValidationCode::InvalidValue, field));
    }
    Ok(())
}

fn has_canonical_rfc3339_shape(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
        || !bytes[..19]
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13 | 16) || byte.is_ascii_digit())
    {
        return false;
    }

    let suffix = &bytes[19..];
    match suffix.first() {
        Some(b'Z') => suffix.len() == 1,
        Some(b'+' | b'-') => valid_timestamp_offset(suffix),
        Some(b'.') => {
            let zone_index = suffix
                .iter()
                .position(|byte| matches!(byte, b'Z' | b'+' | b'-'));
            let Some(zone_index) = zone_index else {
                return false;
            };
            zone_index > 1
                && suffix[1..zone_index].iter().all(u8::is_ascii_digit)
                && match suffix[zone_index] {
                    b'Z' => zone_index + 1 == suffix.len(),
                    b'+' | b'-' => valid_timestamp_offset(&suffix[zone_index..]),
                    _ => false,
                }
        }
        _ => false,
    }
}

fn valid_timestamp_offset(value: &[u8]) -> bool {
    value.len() == 6
        && matches!(value[0], b'+' | b'-')
        && value[1..3].iter().all(u8::is_ascii_digit)
        && value[3] == b':'
        && value[4..6].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::validate_origin;

    #[test]
    fn origin_requires_canonical_https_origin() {
        assert!(validate_origin("https://example.com", "origin").is_ok());
        assert!(validate_origin("https://example.com:8443", "origin").is_ok());
        assert!(validate_origin("https://example.com:443", "origin").is_err());
        assert!(validate_origin("https://example.com/", "origin").is_err());
        assert!(validate_origin("http://example.com", "origin").is_err());
        assert!(validate_origin("https://user@example.com", "origin").is_err());
    }
}
