use std::{env, fs, io, path::PathBuf, process::Stdio, time::Instant};

use futures_util::future::BoxFuture;
use mcpatch_bridge::local_ipc::{
    CoreRendezvousErrorCode, CoreSpawner, EndpointRole, InstallChannel, LocalCoreConnection,
    LocalCoreConnectionErrorCode, LocalRuntime, RendezvousClock, RendezvousPolicy, rendezvous_with,
};
use serde_json::{Value, json};
use tokio::time::timeout;

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use super::{
    CHILD_TIMEOUT, CORE_LOG_ENV, HELPER_ID_ENV, HELPER_MODE_ENV, HELPER_ROOT_ENV,
    IDLE_STOP_TIMEOUT,
    fixture::{
        HelperPaths, wait_for_path, wait_for_path_result, write_marker, write_marker_result,
    },
};

#[ignore = "subprocess helper invoked by the bridge-core process scenario"]
#[tokio::test]
async fn adapter_process_helper() {
    let mode = env::var(HELPER_MODE_ENV).expect("helper mode must be configured");
    let root = PathBuf::from(env::var_os(HELPER_ROOT_ENV).expect("helper root must be configured"));
    let id = env::var(HELPER_ID_ENV).expect("helper id must be configured");
    let paths = HelperPaths::new(&root, &id);
    let runtime = LocalRuntime::prepare(InstallChannel::Development)
        .await
        .expect("helper runtime must be safe");
    let behavior = match mode.as_str() {
        "race" => SpawnBehavior::StartCoreAfterBarrier,
        "timeout" => SpawnBehavior::SucceedWithoutCore,
        "revoke" | "verify" => SpawnBehavior::RejectUnexpectedSpawn,
        _ => panic!("unknown helper mode"),
    };
    let spawner = InstrumentedSpawner::new(paths.clone(), behavior);
    let clock = RealClock::new();
    let started = Instant::now();
    let result = rendezvous_with(
        &runtime,
        &spawner,
        &clock,
        InstallChannel::Development,
        EndpointRole::Mcp,
        RendezvousPolicy::default(),
        0x5eed,
    )
    .await;

    if mode == "timeout" {
        let error = result.expect_err("no core must produce a bounded startup failure");
        assert_eq!(error.code(), CoreRendezvousErrorCode::StartupTimeout);
        assert!(started.elapsed() < CHILD_TIMEOUT);
        fs::write(paths.completed(), error.code().as_str()).unwrap();
        return;
    }

    let mut connection = result.expect("helper must connect to the elected core");
    initialize_and_list_tools(&mut connection).await;
    write_marker(&paths.ready());

    match mode.as_str() {
        "race" => {
            wait_for_path(&paths.continue_probe(), CHILD_TIMEOUT).await;
            list_tools(&mut connection, 3).await;
            write_marker(&paths.survived());
            wait_for_path(&paths.release(), CHILD_TIMEOUT).await;
            drop(connection);
            write_marker(&paths.disconnected());
            wait_for_path(&paths.helper_exit(), IDLE_STOP_TIMEOUT).await;
        }
        "verify" => {
            wait_for_path(&paths.continue_probe(), CHILD_TIMEOUT).await;
            list_tools(&mut connection, 3).await;
            write_marker(&paths.survived());
            wait_for_path(&paths.release(), CHILD_TIMEOUT).await;
        }
        "revoke" => {
            let closed = timeout(CHILD_TIMEOUT, connection.receive_json())
                .await
                .expect("old session was not revoked after the core crashed");
            match closed {
                Ok(None) => {}
                Err(error)
                    if matches!(
                        error.code(),
                        LocalCoreConnectionErrorCode::MalformedFrame
                            | LocalCoreConnectionErrorCode::Transport
                    ) => {}
                result => panic!("old session remained usable after crash: {result:?}"),
            }
            write_marker(&paths.revoked());
        }
        _ => unreachable!(),
    }
}

#[derive(Clone, Copy)]
enum SpawnBehavior {
    StartCoreAfterBarrier,
    SucceedWithoutCore,
    RejectUnexpectedSpawn,
}

struct InstrumentedSpawner {
    binary: PathBuf,
    paths: HelperPaths,
    behavior: SpawnBehavior,
}

impl InstrumentedSpawner {
    fn new(paths: HelperPaths, behavior: SpawnBehavior) -> Self {
        Self {
            binary: env::current_exe().expect("test executable must resolve"),
            paths,
            behavior,
        }
    }
}

impl CoreSpawner for InstrumentedSpawner {
    fn spawn(&self, _channel: InstallChannel) -> BoxFuture<'_, io::Result<()>> {
        Box::pin(async move {
            write_marker_result(&self.paths.spawn_attempted())?;
            match self.behavior {
                SpawnBehavior::SucceedWithoutCore => return Ok(()),
                SpawnBehavior::RejectUnexpectedSpawn => {
                    return Err(io::Error::other("unexpected core spawn"));
                }
                SpawnBehavior::StartCoreAfterBarrier => {
                    wait_for_path_result(&self.paths.spawn_release(), CHILD_TIMEOUT).await?;
                }
            }

            let mut command = std::process::Command::new(&self.binary);
            command
                .args([
                    "--ignored",
                    "--exact",
                    "process_support::core::bridge_core_process_helper",
                    "--nocapture",
                ])
                .current_dir(self.binary.parent().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "test binary has no parent")
                })?)
                .env(CORE_LOG_ENV, self.paths.core_log())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            isolate_core_process(&mut command);
            let child = command.spawn()?;
            fs::write(self.paths.core_pid(), child.id().to_string())?;
            drop(child);
            Ok(())
        })
    }
}

fn isolate_core_process(command: &mut std::process::Command) {
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x0000_0200);
}

struct RealClock {
    started: Instant,
}

impl RealClock {
    fn new() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl RendezvousClock for RealClock {
    fn elapsed(&self) -> std::time::Duration {
        self.started.elapsed()
    }

    fn sleep(&self, duration: std::time::Duration) -> BoxFuture<'_, ()> {
        Box::pin(tokio::time::sleep(duration))
    }
}

async fn initialize_and_list_tools(connection: &mut LocalCoreConnection) {
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "process-lifecycle-test", "version": "0.1.0"}
        }
    });
    connection
        .send_json(&serde_json::to_vec(&initialize).unwrap())
        .await
        .unwrap();
    let response = receive_value(connection).await;
    assert_eq!(response["id"], 1);
    assert_eq!(response["result"]["serverInfo"]["name"], "mcpatch");

    let initialized = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    });
    connection
        .send_json(&serde_json::to_vec(&initialized).unwrap())
        .await
        .unwrap();
    list_tools(connection, 2).await;
}

async fn list_tools(connection: &mut LocalCoreConnection, id: u64) {
    let request = json!({"jsonrpc": "2.0", "id": id, "method": "tools/list", "params": {}});
    connection
        .send_json(&serde_json::to_vec(&request).unwrap())
        .await
        .unwrap();
    let response = receive_value(connection).await;
    assert_eq!(response["id"], id);
    assert_eq!(response["result"]["tools"], json!([]));
}

async fn receive_value(connection: &mut LocalCoreConnection) -> Value {
    let payload = timeout(CHILD_TIMEOUT, connection.receive_json())
        .await
        .expect("core response timed out")
        .expect("core response failed")
        .expect("core closed before responding");
    serde_json::from_slice(&payload).expect("core response must be JSON")
}
