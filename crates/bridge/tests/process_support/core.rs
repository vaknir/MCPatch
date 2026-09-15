use std::{env, fs, io::Write, path::PathBuf};

use mcpatch_bridge::{bridge_core::DEFAULT_IDLE_TIMEOUT, local_ipc::InstallChannel};
use tokio_util::sync::CancellationToken;

#[cfg(unix)]
use mcpatch_bridge::{bridge_core::UnixBridgeCore, local_ipc::UnixRuntime};
#[cfg(windows)]
use mcpatch_bridge::{bridge_core::WindowsBridgeCore, local_ipc::WindowsRuntime};

use super::CORE_LOG_ENV;

#[ignore = "subprocess helper invoked by the bridge-core process scenario"]
#[tokio::test]
async fn bridge_core_process_helper() {
    let log_path = PathBuf::from(env::var_os(CORE_LOG_ENV).expect("core log must be configured"));

    #[cfg(unix)]
    {
        let runtime = UnixRuntime::prepare(InstallChannel::Development)
            .await
            .expect("core helper runtime must be safe");
        let core = match UnixBridgeCore::start(runtime).await {
            Ok(core) => core,
            Err(error) => {
                append_core_log(&log_path, &format!("failed:{}", error.code()));
                return;
            }
        };
        append_core_log(&log_path, &format!("started:{}", core.epoch().as_str()));
        let reason = core
            .run(DEFAULT_IDLE_TIMEOUT, CancellationToken::new())
            .await
            .expect("core helper lifecycle must succeed");
        append_core_log(&log_path, &format!("stopped:{reason:?}"));
    }

    #[cfg(windows)]
    {
        let runtime = WindowsRuntime::current(InstallChannel::Development)
            .expect("core helper runtime must be safe");
        let core = match WindowsBridgeCore::start(runtime) {
            Ok(core) => core,
            Err(error) => {
                append_core_log(&log_path, &format!("failed:{}", error.code()));
                return;
            }
        };
        append_core_log(&log_path, &format!("started:{}", core.epoch().as_str()));
        let reason = core
            .run(DEFAULT_IDLE_TIMEOUT, CancellationToken::new())
            .await
            .expect("core helper lifecycle must succeed");
        append_core_log(&log_path, &format!("stopped:{reason:?}"));
    }
}

fn append_core_log(path: &std::path::Path, line: &str) {
    let mut log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .unwrap();
    writeln!(log, "{line}").unwrap();
}
