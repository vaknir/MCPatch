mod connection;
mod error;
mod framing;
mod rendezvous;
mod role;

#[cfg(unix)]
mod unix;

#[cfg(windows)]
mod windows;

pub use connection::*;
pub use error::*;
pub use framing::*;
pub use rendezvous::*;
pub use role::*;

#[cfg(unix)]
pub use unix::*;

#[cfg(windows)]
pub use windows::*;

/// Local transport compatibility version used in endpoint names.
pub const LOCAL_TRANSPORT_VERSION: u32 = 1;
