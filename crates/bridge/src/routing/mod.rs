mod calls;
mod error;
mod policy;
mod registry;
mod schema;
mod snapshots;
mod state;
mod types;

use std::sync::Arc;

use tokio::sync::Mutex;

pub use error::{RegistryError, RegistryErrorCode};
pub use policy::{PermissionDecision, permission_decision};
pub use registry::CapabilityRegistry;
pub use types::{
    BrowserToolResponse, RegistryChange, RoutedCall, RoutedCancellation, ToolInvocation,
};

pub type SharedCapabilityRegistry = Arc<Mutex<CapabilityRegistry>>;

pub fn shared_capability_registry() -> SharedCapabilityRegistry {
    Arc::new(Mutex::new(CapabilityRegistry::new()))
}
