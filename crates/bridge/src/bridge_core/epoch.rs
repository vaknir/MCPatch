use std::fmt;

/// Fresh, process-local namespace for all runtime authority.
#[derive(Clone, Eq, Hash, PartialEq)]
pub struct BridgeEpoch(String);

impl BridgeEpoch {
    pub fn generate() -> Result<Self, getrandom::Error> {
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes)?;

        let mut value = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            value.push(hex_digit(byte >> 4));
            value.push(hex_digit(byte & 0x0f));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for BridgeEpoch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BridgeEpoch([redacted])")
    }
}

const fn hex_digit(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=15 => (b'a' + value - 10) as char,
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epochs_are_fresh_hex_and_redacted_in_debug_output() {
        let first = BridgeEpoch::generate().unwrap();
        let second = BridgeEpoch::generate().unwrap();

        assert_ne!(first, second);
        assert_eq!(first.as_str().len(), 32);
        assert!(first.as_str().bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(format!("{first:?}"), "BridgeEpoch([redacted])");
        assert!(!format!("{first:?}").contains(first.as_str()));
    }
}
