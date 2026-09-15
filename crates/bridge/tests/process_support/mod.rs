mod adapter;
mod core;
mod fixture;

use std::time::Duration;

pub(super) use fixture::{
    HelperPaths, TestDirectory, assert_core_unavailable, prepare_runtime,
    seed_stale_unix_endpoints, spawn_core, spawn_helper, started_epoch, wait_for_child,
    wait_for_path, wait_for_single_elected_core, wait_for_text, write_marker,
};

pub(super) const CHILD_TIMEOUT: Duration = Duration::from_secs(8);
pub(super) const CORE_START_TIMEOUT: Duration = Duration::from_secs(8);
pub(super) const IDLE_STOP_TIMEOUT: Duration = Duration::from_secs(40);
pub(super) const SCENARIO_TIMEOUT: Duration = Duration::from_secs(60);
const HELPER_MODE_ENV: &str = "MCPATCH_PROCESS_TEST_HELPER_MODE";
const HELPER_ROOT_ENV: &str = "MCPATCH_PROCESS_TEST_ROOT";
const HELPER_ID_ENV: &str = "MCPATCH_PROCESS_TEST_HELPER_ID";
const CORE_LOG_ENV: &str = "MCPATCH_PROCESS_TEST_CORE_LOG";
