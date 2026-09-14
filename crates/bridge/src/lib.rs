#![forbid(unsafe_code)]
//! Native MCPatch policy and routing boundary.

pub mod browser;
pub mod cli;
pub mod logging;
pub mod mcp;
pub mod protocol;

/// The MCPatch product version compiled into the bridge.
pub const PRODUCT_VERSION: &str = env!("CARGO_PKG_VERSION");
