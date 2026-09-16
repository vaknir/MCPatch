mod approval_limits;
mod approvals;
mod calls;
mod error;
mod policy;
mod registry;
mod schema;
mod snapshot_limits;
mod snapshots;
mod state;
mod types;

use std::sync::Arc;

use tokio::sync::Mutex;

pub use approval_limits::{
    APPROVAL_DENIAL_COOLDOWN, APPROVAL_DENIALS_BEFORE_COOLDOWN, APPROVAL_PROMPT_BURST,
    APPROVAL_PROMPT_REFILL_INTERVAL, ApprovalLimitReason,
};
pub use error::{RegistryError, RegistryErrorCode};
pub use policy::{PermissionDecision, permission_decision};
pub use registry::CapabilityRegistry;
pub use snapshot_limits::{SNAPSHOT_BURST, SNAPSHOT_REFILL_INTERVAL};
pub use types::{
    ApprovalCompletionError, ApprovalGrant, BrowserToolResponse, CallReservation, RegistryChange,
    RoutedApproval, RoutedCall, RoutedCallCompletionError, RoutedCancellation, ToolInvocation,
};

const MAX_RESERVED_REQUESTS: usize = 128;

pub type SharedCapabilityRegistry = Arc<Mutex<CapabilityRegistry>>;

pub fn shared_capability_registry() -> SharedCapabilityRegistry {
    Arc::new(Mutex::new(CapabilityRegistry::new()))
}
