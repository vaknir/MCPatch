#![cfg(any(unix, windows))]

mod process_support;

use std::{fs, time::Instant};

use mcpatch_bridge::{bridge_core::DEFAULT_IDLE_TIMEOUT, local_ipc::LocalRuntime};
use tokio::time::timeout;

use process_support::{
    CHILD_TIMEOUT, CORE_START_TIMEOUT, HelperPaths, IDLE_STOP_TIMEOUT, SCENARIO_TIMEOUT,
    TestDirectory, assert_core_unavailable, prepare_runtime, seed_stale_unix_endpoints, spawn_core,
    spawn_helper, started_epoch, wait_for_child, wait_for_path, wait_for_single_elected_core,
    wait_for_text, write_marker,
};

#[tokio::test]
async fn adapters_race_recover_and_observe_bounded_core_lifecycle() {
    timeout(SCENARIO_TIMEOUT, run_process_scenario())
        .await
        .expect("bridge-core process scenario exceeded its deterministic bound");
}

async fn run_process_scenario() {
    let fixture = TestDirectory::new();
    let runtime = prepare_runtime(&fixture).await;
    assert_core_unavailable(&runtime).await;

    verify_bounded_startup_failure(&fixture).await;
    verify_racing_adapters_and_idle_shutdown(&fixture, &runtime).await;
    verify_crash_revocation_and_reconnect(&fixture, &runtime).await;
}

async fn verify_bounded_startup_failure(fixture: &TestDirectory) {
    let paths = HelperPaths::new(fixture.path(), "timeout");
    let started = Instant::now();
    let child = spawn_helper(fixture, &paths, "timeout");
    let status = wait_for_child(child, CHILD_TIMEOUT).await;

    assert!(status.success(), "bounded-startup helper failed");
    assert!(started.elapsed() < CHILD_TIMEOUT);
    assert_eq!(
        fs::read_to_string(paths.completed()).unwrap(),
        "core_startup_timeout"
    );
}

async fn verify_racing_adapters_and_idle_shutdown(fixture: &TestDirectory, runtime: &LocalRuntime) {
    seed_stale_unix_endpoints(fixture).await;

    let first_paths = HelperPaths::new(fixture.path(), "race-a");
    let second_paths = HelperPaths::new(fixture.path(), "race-b");
    let first = spawn_helper(fixture, &first_paths, "race");
    let second = spawn_helper(fixture, &second_paths, "race");

    wait_for_path(&first_paths.spawn_attempted(), CORE_START_TIMEOUT).await;
    wait_for_path(&second_paths.spawn_attempted(), CORE_START_TIMEOUT).await;
    write_marker(&first_paths.spawn_release());

    wait_for_path(&first_paths.ready(), CORE_START_TIMEOUT).await;
    wait_for_path(&second_paths.ready(), CORE_START_TIMEOUT).await;
    let winner_log = wait_for_single_elected_core(&first_paths, &second_paths).await;

    write_marker(&first_paths.continue_probe());
    wait_for_path(&first_paths.survived(), CHILD_TIMEOUT).await;
    wait_for_path(&second_paths.survived(), CHILD_TIMEOUT).await;
    write_marker(&first_paths.release());
    wait_for_path(&first_paths.disconnected(), CHILD_TIMEOUT).await;
    wait_for_path(&second_paths.disconnected(), CHILD_TIMEOUT).await;

    let idle_started = Instant::now();
    wait_for_text(&winner_log, "stopped:Idle", IDLE_STOP_TIMEOUT).await;
    let idle_elapsed = idle_started.elapsed();
    let winner_log = fs::read_to_string(&winner_log).unwrap();
    assert!(
        idle_elapsed >= DEFAULT_IDLE_TIMEOUT.saturating_sub(std::time::Duration::from_secs(1)),
        "core stopped after {idle_elapsed:?}: {}",
        winner_log
    );
    assert_core_unavailable(runtime).await;

    write_marker(&first_paths.helper_exit());
    let (first_status, second_status) = tokio::join!(
        wait_for_child(first, CHILD_TIMEOUT),
        wait_for_child(second, CHILD_TIMEOUT)
    );
    assert!(first_status.success(), "first racing adapter failed");
    assert!(second_status.success(), "second racing adapter failed");
    fs::remove_file(first_paths.continue_probe()).unwrap();
    fs::remove_file(first_paths.release()).unwrap();
    fs::remove_file(first_paths.spawn_release()).unwrap();
    fs::remove_file(first_paths.helper_exit()).unwrap();
}

async fn verify_crash_revocation_and_reconnect(fixture: &TestDirectory, runtime: &LocalRuntime) {
    let first_log = fixture.path().join("explicit-core-a.log");
    let mut first_core = spawn_core(fixture, &first_log);
    wait_for_text(&first_log, "started:", CORE_START_TIMEOUT).await;
    let first_epoch = started_epoch(&first_log);

    let old_paths = HelperPaths::new(fixture.path(), "old-session");
    let old_adapter = spawn_helper(fixture, &old_paths, "revoke");
    wait_for_path(&old_paths.ready(), CORE_START_TIMEOUT).await;
    assert!(!old_paths.spawn_attempted().exists());

    first_core
        .kill()
        .await
        .expect("first core must be killable");
    first_core
        .wait()
        .await
        .expect("first core must be waitable");
    wait_for_path(&old_paths.revoked(), CHILD_TIMEOUT).await;
    assert!(wait_for_child(old_adapter, CHILD_TIMEOUT).await.success());
    assert_core_unavailable(runtime).await;

    let second_log = fixture.path().join("explicit-core-b.log");
    let mut second_core = spawn_core(fixture, &second_log);
    wait_for_text(&second_log, "started:", CORE_START_TIMEOUT).await;
    assert_ne!(started_epoch(&second_log), first_epoch);

    let new_paths = HelperPaths::new(fixture.path(), "new-session");
    let new_adapter = spawn_helper(fixture, &new_paths, "verify");
    wait_for_path(&new_paths.ready(), CORE_START_TIMEOUT).await;
    assert!(!new_paths.spawn_attempted().exists());
    write_marker(&new_paths.continue_probe());
    wait_for_path(&new_paths.survived(), CHILD_TIMEOUT).await;
    write_marker(&new_paths.release());
    assert!(wait_for_child(new_adapter, CHILD_TIMEOUT).await.success());

    second_core
        .kill()
        .await
        .expect("second core must be killable");
    second_core
        .wait()
        .await
        .expect("second core must be waitable");
    assert_core_unavailable(runtime).await;
}
