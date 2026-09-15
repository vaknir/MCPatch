#[cfg(unix)]
mod unix;

#[cfg(test)]
mod tests;

use std::{env, io, path::Path, path::PathBuf, time::Instant};

use futures_util::future::BoxFuture;

use super::{
    CoreRendezvousError, CoreSpawner, JitterSeedSource, RendezvousClock, RendezvousPolicy,
    rendezvous_with_seed_source,
};
use crate::local_ipc::{EndpointRole, InstallChannel, LocalCoreConnection, LocalRuntime};

/// Starts the current MCPatch executable in isolated internal bridge-core mode.
#[derive(Clone, Copy, Debug, Default)]
struct ProcessCoreSpawner;

impl CoreSpawner for ProcessCoreSpawner {
    fn spawn(&self, channel: InstallChannel) -> BoxFuture<'_, io::Result<()>> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || CoreProcessSpec::current(channel)?.spawn())
                .await
                .map_err(|_| io::Error::other("bridge core spawn task failed"))?
        })
    }
}

/// Connect to an authenticated role endpoint, starting the current bridge core once if absent.
pub async fn connect_or_start_core(
    channel: InstallChannel,
    role: EndpointRole,
) -> Result<LocalCoreConnection, CoreRendezvousError> {
    let runtime = LocalRuntime::prepare(channel).await?;
    let clock = TokioRendezvousClock::new();
    rendezvous_with_seed_source(
        &runtime,
        &ProcessCoreSpawner,
        &clock,
        channel,
        role,
        RendezvousPolicy::default(),
        &OperatingSystemJitterSeed,
    )
    .await
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CoreProcessSpec {
    executable: PathBuf,
    channel: InstallChannel,
}

impl CoreProcessSpec {
    fn current(channel: InstallChannel) -> io::Result<Self> {
        env::current_exe().map(|executable| Self::for_executable(executable, channel))
    }

    fn for_executable(executable: PathBuf, channel: InstallChannel) -> Self {
        Self {
            executable,
            channel,
        }
    }

    fn executable(&self) -> &Path {
        &self.executable
    }

    #[cfg(any(unix, test))]
    fn working_directory(&self) -> io::Result<&Path> {
        self.executable
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "bridge executable has no installation directory",
                )
            })
    }

    #[cfg(any(unix, test))]
    fn arguments(&self) -> [&'static str; 2] {
        ["bridge-core", channel_argument(self.channel)]
    }

    fn spawn(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            unix::spawn(self)
        }
        #[cfg(windows)]
        {
            let channel = match self.channel {
                InstallChannel::Development => {
                    mcpatch_windows_kernel::BridgeCoreChannel::Development
                }
                InstallChannel::Production => mcpatch_windows_kernel::BridgeCoreChannel::Production,
            };
            mcpatch_windows_kernel::spawn_bridge_core(self.executable(), channel)
        }
        #[cfg(not(any(unix, windows)))]
        {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "bridge core process spawning is unavailable",
            ))
        }
    }
}

#[cfg(any(unix, test))]
const fn channel_argument(channel: InstallChannel) -> &'static str {
    match channel {
        InstallChannel::Development => "--channel=development",
        InstallChannel::Production => "--channel=production",
    }
}

struct OperatingSystemJitterSeed;

impl JitterSeedSource for OperatingSystemJitterSeed {
    fn generate(&self) -> Result<u64, getrandom::Error> {
        let mut bytes = [0_u8; size_of::<u64>()];
        getrandom::fill(&mut bytes)?;
        Ok(u64::from_le_bytes(bytes))
    }
}

struct TokioRendezvousClock {
    started: Instant,
}

impl TokioRendezvousClock {
    fn new() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl RendezvousClock for TokioRendezvousClock {
    fn elapsed(&self) -> std::time::Duration {
        self.started.elapsed()
    }

    fn sleep(&self, duration: std::time::Duration) -> BoxFuture<'_, ()> {
        Box::pin(tokio::time::sleep(duration))
    }
}
