//! Deterministic per-site budget for approval prompts.
//!
//! Every approval opens a trusted browser prompt. A hostile or looping MCP
//! client could otherwise open prompts indefinitely, which is how
//! argument-bound approvals are defeated in practice: not by breaking the
//! binding, but by wearing the human down until they click through. The
//! budget is keyed by browser connection and origin — the surface the human
//! sees — so it holds whichever client is asking.

use std::collections::BTreeMap;

use time::{Duration, OffsetDateTime};

use crate::browser::BrowserConnectionId;

/// Prompts that may be requested for one site before the bucket is empty.
pub const APPROVAL_PROMPT_BURST: u32 = 6;
/// One prompt token is returned per interval, so the sustained rate is six
/// prompts per minute per site.
pub const APPROVAL_PROMPT_REFILL_INTERVAL: Duration = Duration::seconds(10);
/// Consecutive non-approvals (denials or expiries) that start a cooldown.
pub const APPROVAL_DENIALS_BEFORE_COOLDOWN: u32 = 3;
/// How long a site is locked out after repeated non-approvals.
pub const APPROVAL_DENIAL_COOLDOWN: Duration = Duration::seconds(60);

/// Why a prompt was refused before any browser message was sent.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalLimitReason {
    Burst,
    DenialCooldown,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(super) struct ApprovalLimitKey {
    connection: BrowserConnectionId,
    origin: String,
}

impl ApprovalLimitKey {
    pub(super) fn new(connection: &BrowserConnectionId, origin: &str) -> Self {
        Self {
            connection: connection.clone(),
            origin: origin.to_owned(),
        }
    }
}

#[derive(Clone, Debug)]
struct Bucket {
    tokens: u32,
    refilled_at: OffsetDateTime,
    consecutive_denials: u32,
    cooldown_until: Option<OffsetDateTime>,
}

#[derive(Debug, Default)]
pub(super) struct ApprovalLimiter {
    buckets: BTreeMap<ApprovalLimitKey, Bucket>,
}

impl ApprovalLimiter {
    /// Take one prompt token for the site, or say why none is available.
    pub(super) fn admit(
        &mut self,
        key: ApprovalLimitKey,
        now: OffsetDateTime,
    ) -> Result<(), ApprovalLimitReason> {
        let bucket = self.buckets.entry(key).or_insert(Bucket {
            tokens: APPROVAL_PROMPT_BURST,
            refilled_at: now,
            consecutive_denials: 0,
            cooldown_until: None,
        });
        bucket.refill(now);
        if let Some(until) = bucket.cooldown_until {
            if now < until {
                return Err(ApprovalLimitReason::DenialCooldown);
            }
            bucket.cooldown_until = None;
            bucket.consecutive_denials = 0;
        }
        if bucket.tokens == 0 {
            return Err(ApprovalLimitReason::Burst);
        }
        bucket.tokens -= 1;
        Ok(())
    }

    /// Record how a prompt ended. Only an explicit approval resets the
    /// consecutive-denial count; denials and expiries both count against it,
    /// because a prompt the human ignored is the fatigue signal being bounded.
    pub(super) fn record_outcome(
        &mut self,
        key: &ApprovalLimitKey,
        approved: bool,
        now: OffsetDateTime,
    ) {
        let Some(bucket) = self.buckets.get_mut(key) else {
            return;
        };
        if approved {
            bucket.consecutive_denials = 0;
            return;
        }
        bucket.consecutive_denials = bucket.consecutive_denials.saturating_add(1);
        if bucket.consecutive_denials >= APPROVAL_DENIALS_BEFORE_COOLDOWN {
            bucket.cooldown_until = Some(now + APPROVAL_DENIAL_COOLDOWN);
        }
    }

    pub(super) fn forget_connection(&mut self, connection: &BrowserConnectionId) {
        self.buckets.retain(|key, _| &key.connection != connection);
    }
}

impl Bucket {
    fn refill(&mut self, now: OffsetDateTime) {
        if now <= self.refilled_at {
            return;
        }
        let elapsed = now - self.refilled_at;
        let intervals = elapsed.whole_seconds() / APPROVAL_PROMPT_REFILL_INTERVAL.whole_seconds();
        if intervals <= 0 {
            return;
        }
        let refilled = u32::try_from(intervals).unwrap_or(u32::MAX);
        self.tokens = self
            .tokens
            .saturating_add(refilled)
            .min(APPROVAL_PROMPT_BURST);
        self.refilled_at +=
            APPROVAL_PROMPT_REFILL_INTERVAL * i32::try_from(intervals).unwrap_or(i32::MAX);
    }
}

#[cfg(test)]
mod tests {
    use time::{Duration, OffsetDateTime};

    use super::{
        APPROVAL_DENIAL_COOLDOWN, APPROVAL_DENIALS_BEFORE_COOLDOWN, APPROVAL_PROMPT_BURST,
        APPROVAL_PROMPT_REFILL_INTERVAL, ApprovalLimitKey, ApprovalLimitReason, ApprovalLimiter,
    };
    use crate::browser::BrowserConnectionId;

    fn key(origin: &str) -> ApprovalLimitKey {
        ApprovalLimitKey::new(&BrowserConnectionId::parse("connection-a").unwrap(), origin)
    }

    fn start() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(2_000_000_000).unwrap()
    }

    #[test]
    fn a_site_gets_a_burst_then_one_prompt_per_interval() {
        let mut limiter = ApprovalLimiter::default();
        let now = start();
        for _ in 0..APPROVAL_PROMPT_BURST {
            assert_eq!(limiter.admit(key("https://a.example"), now), Ok(()));
        }
        assert_eq!(
            limiter.admit(key("https://a.example"), now),
            Err(ApprovalLimitReason::Burst)
        );
        // Another site has its own budget.
        assert_eq!(limiter.admit(key("https://b.example"), now), Ok(()));

        let later = now + APPROVAL_PROMPT_REFILL_INTERVAL - Duration::seconds(1);
        assert_eq!(
            limiter.admit(key("https://a.example"), later),
            Err(ApprovalLimitReason::Burst)
        );
        let refilled = now + APPROVAL_PROMPT_REFILL_INTERVAL;
        assert_eq!(limiter.admit(key("https://a.example"), refilled), Ok(()));
        assert_eq!(
            limiter.admit(key("https://a.example"), refilled),
            Err(ApprovalLimitReason::Burst)
        );
    }

    #[test]
    fn refill_never_exceeds_the_burst() {
        let mut limiter = ApprovalLimiter::default();
        let now = start();
        assert_eq!(limiter.admit(key("https://a.example"), now), Ok(()));
        let much_later = now + Duration::hours(1);
        for _ in 0..APPROVAL_PROMPT_BURST {
            assert_eq!(limiter.admit(key("https://a.example"), much_later), Ok(()));
        }
        assert_eq!(
            limiter.admit(key("https://a.example"), much_later),
            Err(ApprovalLimitReason::Burst)
        );
    }

    #[test]
    fn repeated_non_approvals_lock_the_site_until_the_cooldown_ends() {
        let mut limiter = ApprovalLimiter::default();
        let now = start();
        for _ in 0..APPROVAL_DENIALS_BEFORE_COOLDOWN {
            assert_eq!(limiter.admit(key("https://a.example"), now), Ok(()));
            limiter.record_outcome(&key("https://a.example"), false, now);
        }
        assert_eq!(
            limiter.admit(key("https://a.example"), now),
            Err(ApprovalLimitReason::DenialCooldown)
        );
        let almost = now + APPROVAL_DENIAL_COOLDOWN - Duration::seconds(1);
        assert_eq!(
            limiter.admit(key("https://a.example"), almost),
            Err(ApprovalLimitReason::DenialCooldown)
        );
        let released = now + APPROVAL_DENIAL_COOLDOWN;
        assert_eq!(limiter.admit(key("https://a.example"), released), Ok(()));
    }

    #[test]
    fn an_approval_resets_the_denial_count() {
        let mut limiter = ApprovalLimiter::default();
        let now = start();
        limiter.admit(key("https://a.example"), now).unwrap();
        limiter.record_outcome(&key("https://a.example"), false, now);
        limiter.admit(key("https://a.example"), now).unwrap();
        limiter.record_outcome(&key("https://a.example"), false, now);
        limiter.admit(key("https://a.example"), now).unwrap();
        limiter.record_outcome(&key("https://a.example"), true, now);
        limiter.admit(key("https://a.example"), now).unwrap();
        limiter.record_outcome(&key("https://a.example"), false, now);
        limiter.admit(key("https://a.example"), now).unwrap();
        limiter.record_outcome(&key("https://a.example"), false, now);
        // Two denials since the approval: still under the threshold.
        assert_eq!(limiter.admit(key("https://a.example"), now), Ok(()));
    }

    #[test]
    fn forgetting_a_connection_drops_its_budgets_only() {
        let mut limiter = ApprovalLimiter::default();
        let now = start();
        let other = ApprovalLimitKey::new(
            &BrowserConnectionId::parse("connection-b").unwrap(),
            "https://a.example",
        );
        for _ in 0..APPROVAL_PROMPT_BURST {
            limiter.admit(key("https://a.example"), now).unwrap();
            limiter.admit(other.clone(), now).unwrap();
        }
        limiter.forget_connection(&BrowserConnectionId::parse("connection-a").unwrap());
        assert_eq!(limiter.admit(key("https://a.example"), now), Ok(()));
        assert_eq!(limiter.admit(other, now), Err(ApprovalLimitReason::Burst));
    }
}
