mod epoch;
mod error;

use std::time::Duration;

#[cfg(unix)]
mod unix;

#[cfg(windows)]
mod windows;

pub use epoch::*;
pub use error::*;

#[cfg(unix)]
pub use unix::*;

#[cfg(windows)]
pub use windows::*;

/// Fixed grace period before an unreferenced bridge core exits.
pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
