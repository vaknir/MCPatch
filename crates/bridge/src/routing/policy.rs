use std::collections::HashSet;

use crate::protocol::{Capability, CapabilitySource, Permission, Risk};

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
            Permission::Credential | Permission::ArbitraryExecution
        )
    }) {
        return PermissionDecision::Deny;
    }

    let permissions: HashSet<_> = capability.permissions.iter().copied().collect();
    if permissions.contains(&Permission::ExternalNetwork) {
        if capability.source != CapabilitySource::Pack
            || capability.pack.is_none()
            || permissions.len() != 2
        {
            return PermissionDecision::Deny;
        }
        return match capability.risk {
            Risk::Read if permissions.contains(&Permission::Read) => PermissionDecision::Allow,
            Risk::Action if permissions.contains(&Permission::Action) => {
                PermissionDecision::ApprovalRequired
            }
            _ => PermissionDecision::Deny,
        };
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

    #[test]
    fn only_reviewed_pack_reads_and_approved_actions_may_use_network_authority() {
        let mut reviewed = capability(vec![Permission::Read, Permission::ExternalNetwork]);
        reviewed.source = CapabilitySource::Pack;
        reviewed.pack = Some(crate::protocol::PackReference {
            publisher: "test".to_owned(),
            id: "search-pack".to_owned(),
            version: "0.1.0".to_owned(),
            digest: format!("sha256:{}", "a".repeat(64)),
        });
        assert_eq!(permission_decision(&reviewed), PermissionDecision::Allow);

        let mut native = reviewed.clone();
        native.source = CapabilitySource::NativeWebMcp;
        native.pack = None;
        assert_eq!(permission_decision(&native), PermissionDecision::Deny);

        reviewed.risk = Risk::Action;
        reviewed.permissions = vec![Permission::Action, Permission::ExternalNetwork];
        assert_eq!(
            permission_decision(&reviewed),
            PermissionDecision::ApprovalRequired
        );

        reviewed.permissions.push(Permission::Read);
        assert_eq!(permission_decision(&reviewed), PermissionDecision::Deny);
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
