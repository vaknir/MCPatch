use crate::protocol::{Capability, Permission};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PermissionDecision {
    Allow,
    ApprovalRequired,
    Deny,
}

/// Evaluate the fixed version-1 permission policy without relying on model hints.
pub fn permission_decision(capability: &Capability) -> PermissionDecision {
    if capability.permissions.iter().any(|permission| {
        matches!(
            permission,
            Permission::Credential | Permission::ExternalNetwork | Permission::ArbitraryExecution
        )
    }) {
        return PermissionDecision::Deny;
    }

    if capability
        .permissions
        .iter()
        .any(|permission| matches!(permission, Permission::Action | Permission::Sensitive))
    {
        return PermissionDecision::ApprovalRequired;
    }

    if capability.permissions == [Permission::Read] {
        PermissionDecision::Allow
    } else {
        PermissionDecision::Deny
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Map;

    use super::{PermissionDecision, permission_decision};
    use crate::protocol::{Capability, CapabilitySource, Permission, Risk};

    #[test]
    fn strongest_permission_determines_the_decision() {
        assert_eq!(
            permission_decision(&capability(vec![Permission::Read])),
            PermissionDecision::Allow
        );
        assert_eq!(
            permission_decision(&capability(vec![Permission::Read, Permission::Sensitive])),
            PermissionDecision::ApprovalRequired
        );
        assert_eq!(
            permission_decision(&capability(vec![Permission::Read, Permission::Credential])),
            PermissionDecision::Deny
        );
    }

    fn capability(permissions: Vec<Permission>) -> Capability {
        Capability {
            name: "test.read".to_owned(),
            title: None,
            description: "Test".to_owned(),
            origin: "https://example.com".to_owned(),
            source: CapabilitySource::NativeWebMcp,
            pack: None,
            risk: Risk::Read,
            permissions,
            input_schema: Map::new(),
            output_schema: None,
        }
    }
}
