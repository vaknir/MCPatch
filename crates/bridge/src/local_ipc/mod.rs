mod error;
mod framing;
mod role;

#[cfg(unix)]
mod unix;

pub use error::*;
pub use framing::*;
pub use role::*;

#[cfg(unix)]
pub use unix::*;

/// Local transport compatibility version used in endpoint names.
pub const LOCAL_TRANSPORT_VERSION: u32 = 1;
