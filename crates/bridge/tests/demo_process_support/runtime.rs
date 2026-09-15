use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

use mcpatch_bridge::{
    bridge_core::{BridgeCoreError, CoreStopReason},
    local_ipc::InstallChannel,
};
use tokio::{process::Command, task::JoinHandle, time::timeout};
use tokio_util::sync::CancellationToken;

#[cfg(unix)]
use mcpatch_bridge::{bridge_core::UnixBridgeCore, local_ipc::UnixRuntime};
#[cfg(windows)]
use mcpatch_bridge::{bridge_core::WindowsBridgeCore, local_ipc::WindowsRuntime};

use super::TEST_TIMEOUT;

pub(crate) struct RunningCore {
    shutdown: CancellationToken,
    task: JoinHandle<Result<CoreStopReason, BridgeCoreError>>,
}

impl RunningCore {
    #[cfg(unix)]
    pub(crate) async fn start(fixture: &TestDirectory) -> Self {
        let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Production)
            .await
            .expect("test runtime must be private");
        let core = UnixBridgeCore::start(runtime)
            .await
            .expect("bridge core must start");
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
        Self { shutdown, task }
    }

    #[cfg(windows)]
    pub(crate) async fn start(_fixture: &TestDirectory) -> Self {
        let runtime = WindowsRuntime::current(InstallChannel::Production)
            .expect("test runtime must be available");
        let core = WindowsBridgeCore::start(runtime).expect("bridge core must start");
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
        Self { shutdown, task }
    }

    pub(crate) async fn stop(self) {
        self.shutdown.cancel();
        let reason = timeout(TEST_TIMEOUT, self.task)
            .await
            .expect("bridge core shutdown timed out")
            .expect("bridge core task must join")
            .expect("bridge core must stop cleanly");
        assert_eq!(reason, CoreStopReason::Shutdown);
    }
}

pub(crate) fn configure_runtime_environment(command: &mut Command, runtime_base: &Path) {
    #[cfg(target_os = "linux")]
    command.env("XDG_RUNTIME_DIR", runtime_base);
    #[cfg(target_os = "macos")]
    command.env("TMPDIR", runtime_base);
    #[cfg(windows)]
    let _ = (command, runtime_base);
}

static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

pub(crate) struct TestDirectory(PathBuf);

impl TestDirectory {
    pub(crate) fn new() -> Self {
        let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .subsec_nanos();
        let path = std::env::temp_dir().join(format!(
            "d{:x}{sequence:x}{:04x}",
            std::process::id(),
            timestamp & 0xffff
        ));
        create_private_directory(&path);
        Self(path)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(unix)]
fn create_private_directory(path: &Path) {
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700).create(path).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
}

#[cfg(windows)]
fn create_private_directory(path: &Path) {
    fs::create_dir(path).unwrap();
}
