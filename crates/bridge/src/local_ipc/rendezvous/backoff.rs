use std::time::Duration;

pub(super) struct JitteredBackoff {
    next_base: Duration,
    maximum: Duration,
    jitter_percent: u32,
    state: u64,
}

impl JitteredBackoff {
    pub(super) const fn new(
        initial: Duration,
        maximum: Duration,
        jitter_percent: u32,
        seed: u64,
    ) -> Self {
        Self {
            next_base: initial,
            maximum,
            jitter_percent,
            state: if seed == 0 {
                0x9e37_79b9_7f4a_7c15
            } else {
                seed
            },
        }
    }

    pub(super) fn next_delay(&mut self) -> Duration {
        let base = self.next_base;
        self.next_base = self.next_base.saturating_mul(2).min(self.maximum);
        self.state ^= self.state << 13;
        self.state ^= self.state >> 7;
        self.state ^= self.state << 17;

        let spread = u64::from(self.jitter_percent) * 2 + 1;
        let multiplier = u64::from(100 - self.jitter_percent) + self.state % spread;
        let nanos = base.as_nanos().saturating_mul(u128::from(multiplier)) / 100;
        Duration::from_nanos(u64::try_from(nanos).unwrap_or(u64::MAX))
    }
}
