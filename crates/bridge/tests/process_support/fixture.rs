use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use mcpatch_bridge::local_ipc::{
    EndpointRole, InstallChannel, LocalCoreConnectionErrorCode, LocalRuntime,
};
use tokio::{process::Command, time::timeout};

#[cfg(unix)]
use mcpatch_bridge::local_ipc::UnixRuntime;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

use super::{CORE_LOG_ENV, CORE_START_TIMEOUT, HELPER_ID_ENV, HELPER_MODE_ENV, HELPER_ROOT_ENV};

const POLL_INTERVAL: Duration = Duration::from_millis(10);

pub(crate) async fn wait_for_single_elected_core(
    first: &HelperPaths,
    second: &HelperPaths,
) -> PathBuf {
    timeout(CORE_START_TIMEOUT, async {
        loop {
            let first_log = read_if_present(&first.core_log());
            let second_log = read_if_present(&second.core_log());
            let started = [first_log.as_str(), second_log.as_str()]
                .into_iter()
                .filter(|log| log.contains("started:"))
                .count();
            let rejected = [first_log.as_str(), second_log.as_str()]
                .into_iter()
                .filter(|log| log.contains("failed:core_already_running"))
                .count();
            if started == 1 && rejected == 1 {
                return if first_log.contains("started:") {
                    first.core_log()
                } else {
                    second.core_log()
                };
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .expect("two racing starters did not elect exactly one core")
}

pub(crate) fn spawn_helper(
    fixture: &TestDirectory,
    paths: &HelperPaths,
    mode: &str,
) -> tokio::process::Child {
    let mut command = Command::new(env::current_exe().expect("test executable must resolve"));
    command
        .args([
            "--ignored",
            "--exact",
            "process_support::adapter::adapter_process_helper",
            "--nocapture",
        ])
        .env(HELPER_MODE_ENV, mode)
        .env(HELPER_ROOT_ENV, fixture.path())
        .env(HELPER_ID_ENV, &paths.id)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    configure_runtime_environment(&mut command, fixture);
    command.spawn().expect("adapter helper must spawn")
}

pub(crate) fn spawn_core(fixture: &TestDirectory, log_path: &Path) -> tokio::process::Child {
    let binary = env::current_exe().expect("test executable must resolve");
    let mut command = Command::new(&binary);
    command
        .args([
            "--ignored",
            "--exact",
            "process_support::core::bridge_core_process_helper",
            "--nocapture",
        ])
        .current_dir(binary.parent().unwrap())
        .env(CORE_LOG_ENV, log_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    configure_runtime_environment(&mut command, fixture);
    command.spawn().expect("bridge core must spawn")
}

fn configure_runtime_environment(command: &mut Command, fixture: &TestDirectory) {
    #[cfg(target_os = "linux")]
    command.env("XDG_RUNTIME_DIR", fixture.path());
    #[cfg(target_os = "macos")]
    command.env("TMPDIR", fixture.path());
    #[cfg(target_os = "windows")]
    let _ = (command, fixture);
}

pub(crate) async fn prepare_runtime(fixture: &TestDirectory) -> LocalRuntime {
    #[cfg(unix)]
    {
        let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
            .await
            .unwrap();
        LocalRuntime::from(runtime)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = fixture;
        LocalRuntime::prepare(InstallChannel::Development)
            .await
            .unwrap()
    }
}

#[cfg(unix)]
pub(crate) async fn seed_stale_unix_endpoints(fixture: &TestDirectory) {
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    for role in [EndpointRole::Browser, EndpointRole::Mcp] {
        let path = runtime.socket_path(role);
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        drop(listener);
        assert!(path.exists());
    }
}

#[cfg(windows)]
pub(crate) async fn seed_stale_unix_endpoints(_fixture: &TestDirectory) {}

pub(crate) async fn assert_core_unavailable(runtime: &LocalRuntime) {
    timeout(CORE_START_TIMEOUT, async {
        loop {
            match runtime.connect(EndpointRole::Mcp).await {
                Err(error) if error.code() == LocalCoreConnectionErrorCode::Unavailable => return,
                Ok(connection) => drop(connection),
                Err(error) => panic!("unexpected local core state: {:?}", error.code()),
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .expect("core endpoint remained available");
}

pub(crate) async fn wait_for_child(
    mut child: tokio::process::Child,
    bound: Duration,
) -> ExitStatus {
    timeout(bound, child.wait())
        .await
        .expect("subprocess exceeded its deterministic bound")
        .expect("subprocess must be waitable")
}

pub(crate) async fn wait_for_path(path: &Path, bound: Duration) {
    wait_for_path_result(path, bound)
        .await
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
}

pub(crate) async fn wait_for_path_result(path: &Path, bound: Duration) -> io::Result<()> {
    timeout(bound, async {
        while !path.exists() {
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "marker did not appear"))
}

pub(crate) async fn wait_for_text(path: &Path, needle: &str, bound: Duration) {
    timeout(bound, async {
        loop {
            if read_if_present(path).contains(needle) {
                return;
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "{} never contained {needle}: {}",
            path.display(),
            read_if_present(path)
        )
    });
}

pub(crate) fn started_epoch(path: &Path) -> String {
    read_if_present(path)
        .lines()
        .find_map(|line| line.strip_prefix("started:"))
        .expect("core helper did not record an epoch")
        .to_owned()
}

fn read_if_present(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub(crate) fn write_marker(path: &Path) {
    write_marker_result(path).unwrap();
}

pub(crate) fn write_marker_result(path: &Path) -> io::Result<()> {
    fs::write(path, b"ready")
}

#[derive(Clone)]
pub(crate) struct HelperPaths {
    root: PathBuf,
    id: String,
}

impl HelperPaths {
    pub(crate) fn new(root: &Path, id: &str) -> Self {
        Self {
            root: root.to_owned(),
            id: id.to_owned(),
        }
    }

    fn marker(&self, name: &str) -> PathBuf {
        self.root.join(format!("{}-{name}", self.id))
    }

    pub(crate) fn spawn_attempted(&self) -> PathBuf {
        self.marker("spawn-attempted")
    }

    pub(crate) fn spawn_release(&self) -> PathBuf {
        self.root.join("race-spawn-release")
    }

    pub(crate) fn core_log(&self) -> PathBuf {
        self.marker("core.log")
    }

    pub(crate) fn core_pid(&self) -> PathBuf {
        self.marker("core.pid")
    }

    pub(crate) fn ready(&self) -> PathBuf {
        self.marker("ready")
    }

    pub(crate) fn continue_probe(&self) -> PathBuf {
        self.root.join("adapter-continue")
    }

    pub(crate) fn survived(&self) -> PathBuf {
        self.marker("survived")
    }

    pub(crate) fn release(&self) -> PathBuf {
        self.root.join("adapter-release")
    }

    pub(crate) fn revoked(&self) -> PathBuf {
        self.marker("revoked")
    }

    pub(crate) fn disconnected(&self) -> PathBuf {
        self.marker("disconnected")
    }

    pub(crate) fn helper_exit(&self) -> PathBuf {
        self.root.join("race-helper-exit")
    }

    pub(crate) fn completed(&self) -> PathBuf {
        self.marker("completed")
    }
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
        let path = env::temp_dir().join(format!(
            "p{:x}{sequence:x}{:04x}",
            std::process::id(),
            timestamp & 0xffff
        ));

        #[cfg(unix)]
        {
            let mut builder = fs::DirBuilder::new();
            builder.mode(0o700).create(&path).unwrap();
        }
        #[cfg(windows)]
        fs::create_dir(&path).unwrap();

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
