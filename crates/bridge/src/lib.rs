#![forbid(unsafe_code)]
//! Native MCPatch policy and routing boundary.

/// The MCPatch product version compiled into the bridge.
pub const PRODUCT_VERSION: &str = env!("CARGO_PKG_VERSION");
