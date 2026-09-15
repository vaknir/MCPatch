mod channel;
mod core_channel;
mod error;
mod framing;
mod origin;
mod runtime;

pub use channel::*;
pub use core_channel::*;
pub use error::*;
pub use framing::*;
pub use origin::*;
pub use runtime::*;

/// Environment-provided exact extension origin used until installer-owned
/// native-host configuration is implemented.
pub const ALLOWED_EXTENSION_ORIGIN_ENV: &str = "MCPATCH_ALLOWED_EXTENSION_ORIGIN";
