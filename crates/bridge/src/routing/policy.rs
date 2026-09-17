use std::collections::HashSet;

use crate::protocol::{Capability, CapabilitySource, Permission, Risk};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PermissionDecision {
    Allow,
    ApprovalRequired,
    Deny,
}

/// Evaluate the fixed version-1 permission policy without relying on model hints.
///
/// A native WebMCP capability's risk and permissions are declared by the page
/// itself, so an `Allow` resting on them is an allow decided by untrusted
/// input: a site whose tool genuinely writes would execute with no human
/// decision because it labelled itself a read. Every native call therefore
/// needs an argument-bound approval, whatever it claims. See
/// [ADR 0016](../../../../docs/adr/0016-native-webmcp-approval.md).
pub fn permission_decision(capability: &Capability) -> PermissionDecision {
    let decision = declared_permission_decision(capability);
    if decision == PermissionDecision::Allow && capability.source == CapabilitySource::NativeWebMcp
    {
        return PermissionDecision::ApprovalRequired;
    }
    decision
}

/// The decision the capability's own declared risk and permissions imply.
fn declared_permission_decision(capability: &Capability) -> PermissionDecision {
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
    fn a_native_capability_never_reaches_allow_whatever_it_declares() {
        // The page decides these fields, so a read label from a page cannot
        // buy approval-free execution.
        let mut native = capability(vec![Permission::Read]);
        native.source = CapabilitySource::NativeWebMcp;
        assert_eq!(
            permission_decision(&native),
            PermissionDecision::ApprovalRequired
        );

        // The same declaration from a reviewed pack still allows, so the rule
        // is about provenance rather than the permission set.
        let reviewed = capability(vec![Permission::Read]);
        assert_eq!(permission_decision(&reviewed), PermissionDecision::Allow);

        // Denials are not softened into an approval prompt.
        let mut credentialed = native.clone();
        credentialed.permissions = vec![Permission::Read, Permission::Credential];
        assert_eq!(permission_decision(&credentialed), PermissionDecision::Deny);
        let mut unknown = native;
        unknown.permissions = vec![];
        assert_eq!(permission_decision(&unknown), PermissionDecision::Deny);
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
            source: CapabilitySource::Pack,
            pack: None,
            risk: Risk::Read,
            permissions,
            input_schema: Map::new(),
            output_schema: None,
        }
    }
}
