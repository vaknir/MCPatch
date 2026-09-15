use std::{
    collections::VecDeque,
    io,
    sync::{
        Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

use futures_util::future::BoxFuture;

use super::{
    CoreConnector, CoreRendezvousErrorCode, CoreSpawner, RendezvousClock, RendezvousPolicy,
    backoff::JitteredBackoff, rendezvous_with,
};
use crate::local_ipc::{
    EndpointRole, InstallChannel, LocalCoreConnectionError, LocalCoreConnectionErrorCode,
    LocalFrameError, LocalFrameErrorCode,
};

#[cfg(unix)]
use crate::local_ipc::{UnixIpcError, UnixIpcErrorCode};
#[cfg(windows)]
use crate::local_ipc::{WindowsIpcError, WindowsIpcErrorCode};

const TEST_POLICY: RendezvousPolicy = RendezvousPolicy::for_test(
    Duration::from_millis(100),
    Duration::from_millis(10),
    Duration::from_millis(40),
    20,
);

#[tokio::test]
async fn connects_before_spawning_when_the_core_is_ready() {
    let connector = ScriptedConnector::new([Ok(7)]);
    let spawner = FakeSpawner::succeeds();
    let clock = FakeClock::default();

    let connection = rendezvous_with(
        &connector,
        &spawner,
        &clock,
        InstallChannel::Development,
        EndpointRole::Browser,
        TEST_POLICY,
        1,
    )
    .await
    .unwrap();

    assert_eq!(connection, 7);
    assert_eq!(connector.calls(), 1);
    assert_eq!(spawner.calls(), 0);
    assert!(clock.sleeps().is_empty());
}

#[tokio::test]
async fn spawns_once_and_retries_only_unavailable_connections() {
    let connector = ScriptedConnector::new([
        Err(connection_error(LocalCoreConnectionErrorCode::Unavailable)),
        Err(connection_error(LocalCoreConnectionErrorCode::Unavailable)),
        Ok(9),
    ]);
    let spawner = FakeSpawner::succeeds();
    let clock = FakeClock::default();

    let connection = rendezvous_with(
        &connector,
        &spawner,
        &clock,
        InstallChannel::Production,
        EndpointRole::Mcp,
        TEST_POLICY,
        7,
    )
    .await
    .unwrap();

    assert_eq!(connection, 9);
    assert_eq!(connector.calls(), 3);
    assert_eq!(spawner.calls(), 1);
    assert_eq!(clock.sleeps().len(), 2);
}

#[tokio::test]
async fn rejects_nonretryable_failures_without_spawning() {
    for code in [
        LocalCoreConnectionErrorCode::Unauthorized,
        #[cfg(unix)]
        LocalCoreConnectionErrorCode::UnsafeRuntime,
        LocalCoreConnectionErrorCode::MalformedFrame,
        LocalCoreConnectionErrorCode::Transport,
    ] {
        let connector = ScriptedConnector::new([Err(connection_error(code))]);
        let spawner = FakeSpawner::succeeds();
        let clock = FakeClock::default();

        let error = rendezvous_with(
            &connector,
            &spawner,
            &clock,
            InstallChannel::Development,
            EndpointRole::Browser,
            TEST_POLICY,
            11,
        )
        .await
        .unwrap_err();

        assert_eq!(error.code(), CoreRendezvousErrorCode::Connection(code));
        assert_eq!(spawner.calls(), 0);
        assert!(clock.sleeps().is_empty());
    }
}

#[tokio::test]
async fn stops_on_a_nonretryable_failure_after_spawn() {
    let connector = ScriptedConnector::new([
        Err(connection_error(LocalCoreConnectionErrorCode::Unavailable)),
        Err(connection_error(LocalCoreConnectionErrorCode::Unauthorized)),
    ]);
    let spawner = FakeSpawner::succeeds();
    let clock = FakeClock::default();

    let error = rendezvous_with(
        &connector,
        &spawner,
        &clock,
        InstallChannel::Development,
        EndpointRole::Browser,
        TEST_POLICY,
        13,
    )
    .await
    .unwrap_err();

    assert_eq!(
        error.code(),
        CoreRendezvousErrorCode::Connection(LocalCoreConnectionErrorCode::Unauthorized)
    );
    assert_eq!(spawner.calls(), 1);
    assert_eq!(connector.calls(), 2);
}

#[tokio::test]
async fn reports_spawn_failure_without_retrying() {
    let connector = ScriptedConnector::new([Err(connection_error(
        LocalCoreConnectionErrorCode::Unavailable,
    ))]);
    let spawner = FakeSpawner::fails();
    let clock = FakeClock::default();

    let error = rendezvous_with(
        &connector,
        &spawner,
        &clock,
        InstallChannel::Production,
        EndpointRole::Mcp,
        TEST_POLICY,
        17,
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), CoreRendezvousErrorCode::SpawnFailed);
    assert_eq!(connector.calls(), 1);
    assert_eq!(spawner.calls(), 1);
    assert!(clock.sleeps().is_empty());
}

#[tokio::test]
async fn bounds_a_stalled_initial_connection_without_spawning() {
    let connector = PendingConnector;
    let spawner = FakeSpawner::succeeds();
    let clock = FakeClock::default();

    let error = rendezvous_with(
        &connector,
        &spawner,
        &clock,
        InstallChannel::Development,
        EndpointRole::Browser,
        TEST_POLICY,
        18,
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), CoreRendezvousErrorCode::StartupTimeout);
    assert_eq!(spawner.calls(), 0);
    assert_eq!(clock.elapsed(), TEST_POLICY.timeout);
}

#[tokio::test]
async fn bounds_a_stalled_spawn_without_retrying_connections() {
    let connector = ScriptedConnector::new([Err(connection_error(
        LocalCoreConnectionErrorCode::Unavailable,
    ))]);
    let spawner = FakeSpawner::pending();
    let clock = FakeClock::default();

    let error = rendezvous_with(
        &connector,
        &spawner,
        &clock,
        InstallChannel::Production,
        EndpointRole::Mcp,
        TEST_POLICY,
        18,
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), CoreRendezvousErrorCode::StartupTimeout);
    assert_eq!(connector.calls(), 1);
    assert_eq!(spawner.calls(), 1);
    assert_eq!(clock.elapsed(), TEST_POLICY.timeout);
}

#[tokio::test]
async fn times_out_at_the_exact_bound_with_one_spawn() {
    let connector = ScriptedConnector::always_unavailable();
    let spawner = FakeSpawner::succeeds();
    let clock = FakeClock::default();

    let error = rendezvous_with(
        &connector,
        &spawner,
        &clock,
        InstallChannel::Production,
        EndpointRole::Browser,
        TEST_POLICY,
        19,
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), CoreRendezvousErrorCode::StartupTimeout);
    assert_eq!(error.code().as_str(), "core_startup_timeout");
    assert_eq!(spawner.calls(), 1);
    assert_eq!(clock.elapsed(), TEST_POLICY.timeout);
    assert!(clock.sleeps().iter().all(|delay| !delay.is_zero()));
}

#[test]
fn backoff_is_exponential_capped_and_jittered_within_twenty_percent() {
    let mut backoff =
        JitteredBackoff::new(Duration::from_millis(10), Duration::from_millis(40), 20, 23);
    for base in [10_u64, 20, 40, 40, 40] {
        let delay = u64::try_from(backoff.next_delay().as_millis()).unwrap();
        assert!((base * 80 / 100..=base * 120 / 100).contains(&delay));
    }
}

#[test]
fn failure_codes_and_display_are_stable_and_payload_free() {
    assert_eq!(
        CoreRendezvousErrorCode::Connection(LocalCoreConnectionErrorCode::Unavailable).as_str(),
        "local_core_unavailable"
    );
    assert_eq!(
        CoreRendezvousErrorCode::EntropyUnavailable.as_str(),
        "core_startup_entropy_unavailable"
    );
    assert_eq!(
        CoreRendezvousErrorCode::SpawnFailed.as_str(),
        "core_spawn_failed"
    );
    assert_eq!(
        CoreRendezvousErrorCode::StartupTimeout.as_str(),
        "core_startup_timeout"
    );

    let error = super::CoreRendezvousError::Spawn(io::Error::other("sensitive OS detail"));
    assert_eq!(error.to_string(), "bridge core process spawn failed");
    assert!(!error.to_string().contains("sensitive"));
}

struct ScriptedConnector {
    outcomes: Mutex<VecDeque<Result<u8, LocalCoreConnectionError>>>,
    calls: AtomicUsize,
    repeat_unavailable: bool,
}

struct PendingConnector;

impl CoreConnector for PendingConnector {
    type Connection = u8;

    fn connect(
        &self,
        _role: EndpointRole,
    ) -> BoxFuture<'_, Result<Self::Connection, LocalCoreConnectionError>> {
        Box::pin(std::future::pending())
    }
}

impl ScriptedConnector {
    fn new(outcomes: impl IntoIterator<Item = Result<u8, LocalCoreConnectionError>>) -> Self {
        Self {
            outcomes: Mutex::new(outcomes.into_iter().collect()),
            calls: AtomicUsize::new(0),
            repeat_unavailable: false,
        }
    }

    fn always_unavailable() -> Self {
        Self {
            outcomes: Mutex::new(VecDeque::new()),
            calls: AtomicUsize::new(0),
            repeat_unavailable: true,
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::Acquire)
    }
}

impl CoreConnector for ScriptedConnector {
    type Connection = u8;

    fn connect(
        &self,
        _role: EndpointRole,
    ) -> BoxFuture<'_, Result<Self::Connection, LocalCoreConnectionError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::AcqRel);
            if let Some(outcome) = self.outcomes.lock().unwrap().pop_front() {
                outcome
            } else if self.repeat_unavailable {
                Err(connection_error(LocalCoreConnectionErrorCode::Unavailable))
            } else {
                panic!("scripted connector exhausted")
            }
        })
    }
}

struct FakeSpawner {
    calls: AtomicUsize,
    outcome: SpawnOutcome,
}

#[derive(Clone, Copy)]
enum SpawnOutcome {
    Failure,
    Pending,
    Success,
}

impl FakeSpawner {
    const fn succeeds() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            outcome: SpawnOutcome::Success,
        }
    }

    const fn fails() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            outcome: SpawnOutcome::Failure,
        }
    }

    const fn pending() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            outcome: SpawnOutcome::Pending,
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::Acquire)
    }
}

impl CoreSpawner for FakeSpawner {
    fn spawn(&self, _channel: InstallChannel) -> BoxFuture<'_, io::Result<()>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::AcqRel);
            match self.outcome {
                SpawnOutcome::Failure => Err(io::Error::other("injected spawn failure")),
                SpawnOutcome::Pending => std::future::pending().await,
                SpawnOutcome::Success => Ok(()),
            }
        })
    }
}

#[derive(Default)]
struct FakeClock {
    elapsed_nanos: AtomicU64,
    sleeps: Mutex<Vec<Duration>>,
}

impl FakeClock {
    fn sleeps(&self) -> Vec<Duration> {
        self.sleeps.lock().unwrap().clone()
    }
}

impl RendezvousClock for FakeClock {
    fn elapsed(&self) -> Duration {
        Duration::from_nanos(self.elapsed_nanos.load(Ordering::Acquire))
    }

    fn sleep(&self, duration: Duration) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            self.sleeps.lock().unwrap().push(duration);
            self.elapsed_nanos.fetch_add(
                u64::try_from(duration.as_nanos()).unwrap(),
                Ordering::AcqRel,
            );
        })
    }
}

fn connection_error(code: LocalCoreConnectionErrorCode) -> LocalCoreConnectionError {
    if code == LocalCoreConnectionErrorCode::MalformedFrame {
        return LocalCoreConnectionError::Frame(LocalFrameError::without_source(
            LocalFrameErrorCode::InvalidJson,
        ));
    }

    #[cfg(unix)]
    {
        let code = match code {
            LocalCoreConnectionErrorCode::Unavailable => UnixIpcErrorCode::EndpointUnavailable,
            LocalCoreConnectionErrorCode::Unauthorized => UnixIpcErrorCode::PeerUnauthorized,
            LocalCoreConnectionErrorCode::UnsafeRuntime => UnixIpcErrorCode::UnsafeRuntimeDirectory,
            LocalCoreConnectionErrorCode::Transport => UnixIpcErrorCode::Io,
            LocalCoreConnectionErrorCode::MalformedFrame => unreachable!(),
        };
        LocalCoreConnectionError::Unix(UnixIpcError::without_source(code))
    }
    #[cfg(windows)]
    {
        let code = match code {
            LocalCoreConnectionErrorCode::Unavailable => WindowsIpcErrorCode::EndpointUnavailable,
            LocalCoreConnectionErrorCode::Unauthorized => WindowsIpcErrorCode::PeerUnauthorized,
            LocalCoreConnectionErrorCode::UnsafeRuntime
            | LocalCoreConnectionErrorCode::Transport => WindowsIpcErrorCode::Io,
            LocalCoreConnectionErrorCode::MalformedFrame => unreachable!(),
        };
        LocalCoreConnectionError::Windows(WindowsIpcError::without_source(code))
    }
}
