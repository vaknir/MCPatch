mod backoff;
mod error;
mod process;

#[cfg(test)]
mod tests;

use std::{future::Future, io, time::Duration};

use futures_util::future::BoxFuture;

use self::backoff::JitteredBackoff;
pub use self::error::{CoreRendezvousError, CoreRendezvousErrorCode};
pub use self::process::connect_or_start_core;
use crate::local_ipc::{
    EndpointRole, InstallChannel, LocalCoreConnection, LocalCoreConnectionError,
    LocalCoreConnectionErrorCode, LocalRuntime,
};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(2);
const INITIAL_RETRY_DELAY: Duration = Duration::from_millis(25);
const MAXIMUM_RETRY_DELAY: Duration = Duration::from_millis(250);
const RETRY_JITTER_PERCENT: u32 = 20;

/// Fixed startup bounds used by adapter rendezvous.
#[derive(Clone, Copy, Debug)]
pub struct RendezvousPolicy {
    timeout: Duration,
    initial_delay: Duration,
    maximum_delay: Duration,
    jitter_percent: u32,
}

impl Default for RendezvousPolicy {
    fn default() -> Self {
        Self {
            timeout: STARTUP_TIMEOUT,
            initial_delay: INITIAL_RETRY_DELAY,
            maximum_delay: MAXIMUM_RETRY_DELAY,
            jitter_percent: RETRY_JITTER_PERCENT,
        }
    }
}

impl RendezvousPolicy {
    #[cfg(test)]
    const fn for_test(
        timeout: Duration,
        initial_delay: Duration,
        maximum_delay: Duration,
        jitter_percent: u32,
    ) -> Self {
        Self {
            timeout,
            initial_delay,
            maximum_delay,
            jitter_percent,
        }
    }
}

/// Injected authenticated endpoint connector.
pub trait CoreConnector: Sync {
    type Connection: Send;

    fn connect(
        &self,
        role: EndpointRole,
    ) -> BoxFuture<'_, Result<Self::Connection, LocalCoreConnectionError>>;
}

impl CoreConnector for LocalRuntime {
    type Connection = LocalCoreConnection;

    fn connect(
        &self,
        role: EndpointRole,
    ) -> BoxFuture<'_, Result<Self::Connection, LocalCoreConnectionError>> {
        Box::pin(LocalRuntime::connect(self, role))
    }
}

/// Injected one-shot bridge-core process starter.
pub trait CoreSpawner: Sync {
    fn spawn(&self, channel: InstallChannel) -> BoxFuture<'_, io::Result<()>>;
}

/// Injected monotonic time and sleeping boundary.
///
/// `elapsed` measures time since the beginning of this rendezvous attempt. Callers
/// must provide a fresh clock for each attempt.
pub trait RendezvousClock: Sync {
    fn elapsed(&self) -> Duration;

    fn sleep(&self, duration: Duration) -> BoxFuture<'_, ()>;
}

pub(super) trait JitterSeedSource: Sync {
    fn generate(&self) -> Result<u64, getrandom::Error>;
}

struct FixedJitterSeed(u64);

impl JitterSeedSource for FixedJitterSeed {
    fn generate(&self) -> Result<u64, getrandom::Error> {
        Ok(self.0)
    }
}

/// Apply connect-first, one-spawn, bounded retry semantics.
pub async fn rendezvous_with<C, S, T>(
    connector: &C,
    spawner: &S,
    clock: &T,
    channel: InstallChannel,
    role: EndpointRole,
    policy: RendezvousPolicy,
    jitter_seed: u64,
) -> Result<C::Connection, CoreRendezvousError>
where
    C: CoreConnector,
    S: CoreSpawner,
    T: RendezvousClock,
{
    rendezvous_with_seed_source(
        connector,
        spawner,
        clock,
        channel,
        role,
        policy,
        &FixedJitterSeed(jitter_seed),
    )
    .await
}

pub(super) async fn rendezvous_with_seed_source<C, S, T, E>(
    connector: &C,
    spawner: &S,
    clock: &T,
    channel: InstallChannel,
    role: EndpointRole,
    policy: RendezvousPolicy,
    jitter_seed: &E,
) -> Result<C::Connection, CoreRendezvousError>
where
    C: CoreConnector,
    S: CoreSpawner,
    T: RendezvousClock,
    E: JitterSeedSource,
{
    match before_deadline(connector.connect(role), clock, policy.timeout).await? {
        Ok(connection) => return Ok(connection),
        Err(error) if error.code() == LocalCoreConnectionErrorCode::Unavailable => {}
        Err(error) => return Err(error.into()),
    }

    let jitter_seed = jitter_seed
        .generate()
        .map_err(CoreRendezvousError::Entropy)?;
    before_deadline(spawner.spawn(channel), clock, policy.timeout)
        .await?
        .map_err(CoreRendezvousError::Spawn)?;
    let mut backoff = JitteredBackoff::new(
        policy.initial_delay,
        policy.maximum_delay,
        policy.jitter_percent,
        jitter_seed,
    );

    loop {
        let Some(remaining) = policy.timeout.checked_sub(clock.elapsed()) else {
            return Err(CoreRendezvousError::Timeout);
        };
        if remaining.is_zero() {
            return Err(CoreRendezvousError::Timeout);
        }
        clock.sleep(backoff.next_delay().min(remaining)).await;
        if clock.elapsed() >= policy.timeout {
            return Err(CoreRendezvousError::Timeout);
        }

        match before_deadline(connector.connect(role), clock, policy.timeout).await? {
            Ok(connection) => return Ok(connection),
            Err(error) if error.code() == LocalCoreConnectionErrorCode::Unavailable => {}
            Err(error) => return Err(error.into()),
        }
    }
}

async fn before_deadline<F, O, T>(
    operation: F,
    clock: &T,
    timeout: Duration,
) -> Result<O, CoreRendezvousError>
where
    F: Future<Output = O>,
    T: RendezvousClock,
{
    let Some(remaining) = timeout.checked_sub(clock.elapsed()) else {
        return Err(CoreRendezvousError::Timeout);
    };
    if remaining.is_zero() {
        return Err(CoreRendezvousError::Timeout);
    }

    tokio::select! {
        biased;
        output = operation => Ok(output),
        () = clock.sleep(remaining) => Err(CoreRendezvousError::Timeout),
    }
}
