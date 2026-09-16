//! Deterministic per-connection budget for capability snapshots.
//!
//! Every accepted snapshot compiles up to 256 schemas. A page can republish as
//! fast as it can fire `toolchange`, so without a budget one hostile tab could
//! hold the user's bridge at sustained CPU for every MCP client. The budget is
//! generous for real pages — a burst of thirty, then ten per second — and a
//! connection that exceeds it is closed, which revokes its contexts and lets the
//! extension reconnect cleanly rather than leaving bridge and page state apart.

use std::collections::BTreeMap;

use time::{Duration, OffsetDateTime};

use crate::browser::BrowserConnectionId;

/// Snapshots one connection may publish before its bucket is empty.
pub const SNAPSHOT_BURST: u32 = 30;
/// One snapshot token is returned per interval: ten snapshots per second.
pub const SNAPSHOT_REFILL_INTERVAL: Duration = Duration::milliseconds(100);

#[derive(Clone, Debug)]
struct Bucket {
    tokens: u32,
    refilled_at: OffsetDateTime,
}

#[derive(Debug, Default)]
pub(super) struct SnapshotLimiter {
    buckets: BTreeMap<BrowserConnectionId, Bucket>,
}

impl SnapshotLimiter {
    /// Take one snapshot token for the connection, or report that none is left.
    pub(super) fn admit(&mut self, connection: &BrowserConnectionId, now: OffsetDateTime) -> bool {
        let bucket = self.buckets.entry(connection.clone()).or_insert(Bucket {
            tokens: SNAPSHOT_BURST,
            refilled_at: now,
        });
        bucket.refill(now);
        if bucket.tokens == 0 {
            return false;
        }
        bucket.tokens -= 1;
        true
    }

    pub(super) fn forget_connection(&mut self, connection: &BrowserConnectionId) {
        self.buckets.remove(connection);
    }
}

impl Bucket {
    fn refill(&mut self, now: OffsetDateTime) {
        if now <= self.refilled_at {
            return;
        }
        let elapsed = now - self.refilled_at;
        let intervals =
            elapsed.whole_milliseconds() / SNAPSHOT_REFILL_INTERVAL.whole_milliseconds();
        if intervals <= 0 {
            return;
        }
        let refilled = u32::try_from(intervals).unwrap_or(u32::MAX);
        self.tokens = self.tokens.saturating_add(refilled).min(SNAPSHOT_BURST);
        self.refilled_at += SNAPSHOT_REFILL_INTERVAL * i32::try_from(intervals).unwrap_or(i32::MAX);
    }
}

#[cfg(test)]
mod tests {
    use time::{Duration, OffsetDateTime};

    use super::{SNAPSHOT_BURST, SNAPSHOT_REFILL_INTERVAL, SnapshotLimiter};
    use crate::browser::BrowserConnectionId;

    fn connection(id: &str) -> BrowserConnectionId {
        BrowserConnectionId::parse(id).unwrap()
    }

    fn start() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(2_000_000_000).unwrap()
    }

    #[test]
    fn a_connection_gets_a_burst_then_ten_per_second() {
        let mut limiter = SnapshotLimiter::default();
        let now = start();
        for _ in 0..SNAPSHOT_BURST {
            assert!(limiter.admit(&connection("connection-a"), now));
        }
        assert!(!limiter.admit(&connection("connection-a"), now));
        assert!(limiter.admit(&connection("connection-b"), now));

        let just_before = now + SNAPSHOT_REFILL_INTERVAL - Duration::milliseconds(1);
        assert!(!limiter.admit(&connection("connection-a"), just_before));
        let refilled = now + SNAPSHOT_REFILL_INTERVAL;
        assert!(limiter.admit(&connection("connection-a"), refilled));
        assert!(!limiter.admit(&connection("connection-a"), refilled));

        let second_later = refilled + Duration::seconds(1);
        for _ in 0..10 {
            assert!(limiter.admit(&connection("connection-a"), second_later));
        }
        assert!(!limiter.admit(&connection("connection-a"), second_later));
    }

    #[test]
    fn refill_is_capped_at_the_burst_and_forgetting_resets() {
        let mut limiter = SnapshotLimiter::default();
        let now = start();
        for _ in 0..SNAPSHOT_BURST {
            limiter.admit(&connection("connection-a"), now);
        }
        let much_later = now + Duration::hours(1);
        for _ in 0..SNAPSHOT_BURST {
            assert!(limiter.admit(&connection("connection-a"), much_later));
        }
        assert!(!limiter.admit(&connection("connection-a"), much_later));

        limiter.forget_connection(&connection("connection-a"));
        assert!(limiter.admit(&connection("connection-a"), much_later));
    }
}
