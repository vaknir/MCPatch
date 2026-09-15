mod epoch;

use std::time::Duration;

#[cfg(unix)]
mod unix;

pub use epoch::*;

#[cfg(unix)]
pub use unix::*;

/// Fixed grace period before an unreferenced bridge core exits.
pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
