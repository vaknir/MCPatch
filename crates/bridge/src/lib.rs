#![forbid(unsafe_code)]
//! Native MCPatch policy and routing boundary.

pub mod bridge_core;
pub mod browser;
pub mod cli;
pub mod installation;
pub mod local_ipc;
pub mod logging;
pub mod mcp;
pub mod native_host;
pub mod protocol;
pub mod routing;

/// The MCPatch product version compiled into the bridge.
pub const PRODUCT_VERSION: &str = env!("CARGO_PKG_VERSION");
