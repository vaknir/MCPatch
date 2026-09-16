use interprocess::os::windows::security_descriptor::SecurityDescriptor;
use widestring::U16CString;

use crate::local_ipc::{WindowsIpcError, WindowsIpcErrorCode};

pub(super) fn security_descriptor_for(
    logon_sid: &str,
) -> Result<SecurityDescriptor, WindowsIpcError> {
    deserialize(&security_descriptor_sddl(logon_sid))
}

pub(super) fn mutex_security_descriptor_for(
    logon_sid: &str,
) -> Result<SecurityDescriptor, WindowsIpcError> {
    deserialize(&mutex_security_descriptor_sddl(logon_sid))
}

fn deserialize(sddl: &str) -> Result<SecurityDescriptor, WindowsIpcError> {
    let wide = U16CString::from_str(sddl).map_err(|_| descriptor_unavailable())?;
    SecurityDescriptor::deserialize(&wide).map_err(|error| {
        WindowsIpcError::with_source(WindowsIpcErrorCode::SecurityDescriptorUnavailable, error)
    })
}

fn security_descriptor_sddl(logon_sid: &str) -> String {
    // Protected DACL: exactly one allow ACE for duplex read/write by this logon.
    format!("D:P(A;;GRGW;;;{logon_sid})")
}

fn mutex_security_descriptor_sddl(logon_sid: &str) -> String {
    // Protected DACL: synchronize + mutex-modify-state for this logon only.
    format!("D:P(A;;0x00100001;;;{logon_sid})")
}

const fn descriptor_unavailable() -> WindowsIpcError {
    WindowsIpcError::without_source(WindowsIpcErrorCode::SecurityDescriptorUnavailable)
}

#[cfg(test)]
mod tests {
    use firehazard::winapi::um::winnt::DACL_SECURITY_INFORMATION;
    use interprocess::os::windows::security_descriptor::AsSecurityDescriptorExt;

    use super::*;
    use crate::local_ipc::windows::identity::current_process_logon_sid;

    #[test]
    fn dacl_contains_only_the_expected_logon_sid() {
        let sid = current_process_logon_sid().unwrap();
        let expected = security_descriptor_sddl(&sid);
        assert_eq!(expected, format!("D:P(A;;GRGW;;;{sid})"));

        let descriptor = security_descriptor_for(&sid).unwrap();
        let serialized = descriptor
            .serialize(DACL_SECURITY_INFORMATION, |value| value.to_string_lossy())
            .unwrap();

        // Exactly one allow ACE, for this logon SID, and no inherited ACEs.
        assert_eq!(serialized.matches("(A;").count(), 1);
        assert_eq!(serialized.matches("(D;").count(), 0);
        assert_eq!(serialized.matches(&sid).count(), 1);
        // A protected DACL, so no ACL inheritance can widen it.
        assert!(serialized.starts_with("D:P"));
        // No rights to Everyone, Anonymous, Authenticated Users, or the
        // Network principal (the SIDs a cross-user or remote peer would carry).
        for principal in [";;;WD)", ";;;AN)", ";;;AU)", ";;;NU)"] {
            assert!(
                !serialized.contains(principal),
                "DACL must not grant {principal}: {serialized}"
            );
        }
    }
    #[test]
    fn mutex_dacl_grants_only_required_rights_to_the_logon_sid() {
        let sid = current_process_logon_sid().unwrap();
        let expected = mutex_security_descriptor_sddl(&sid);
        assert_eq!(expected, format!("D:P(A;;0x00100001;;;{sid})"));

        let descriptor = mutex_security_descriptor_for(&sid).unwrap();
        let serialized = descriptor
            .serialize(DACL_SECURITY_INFORMATION, |value| value.to_string_lossy())
            .unwrap();

        assert_eq!(serialized.matches("(A;").count(), 1);
        assert_eq!(serialized.matches(&sid).count(), 1);
        assert!(serialized.starts_with("D:P"));
        for principal in [";;;WD)", ";;;AN)", ";;;AU)", ";;;NU)"] {
            assert!(
                !serialized.contains(principal),
                "mutex DACL must not grant {principal}: {serialized}"
            );
        }
    }
}
