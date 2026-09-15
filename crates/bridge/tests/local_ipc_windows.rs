#![cfg(windows)]

use std::{
    sync::{Arc, Barrier, mpsc},
    thread,
    time::Duration,
};

use mcpatch_bridge::{
    bridge_core::{BridgeCoreError, CoreStopReason, WindowsBridgeCore},
    local_ipc::{
        EndpointRole, InstallChannel, WindowsIpcErrorCode, WindowsRuntime, write_json_frame,
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::windows::named_pipe::{ClientOptions, NamedPipeClient},
    time::timeout,
};
use tokio_util::sync::CancellationToken;

#[test]
fn protected_mutex_elects_one_core_and_releases_cleanly() {
    let runtime = WindowsRuntime::current(InstallChannel::Development).unwrap();
    let first = runtime.try_elect_core().unwrap();

    let error = runtime.try_elect_core().unwrap_err();
    assert_eq!(error.code(), WindowsIpcErrorCode::CoreAlreadyRunning);

    drop(first);
    runtime.try_elect_core().unwrap();
}

#[test]
fn protected_mutex_allows_exactly_one_racing_core() {
    const RACERS: usize = 8;
    let runtime = WindowsRuntime::current(InstallChannel::Production).unwrap();
    let start = Arc::new(Barrier::new(RACERS + 1));
    let release = Arc::new(Barrier::new(RACERS + 1));
    let (results_tx, results_rx) = mpsc::sync_channel(RACERS);
    let mut racers = Vec::with_capacity(RACERS);

    for _ in 0..RACERS {
        let runtime = runtime.clone();
        let start = Arc::clone(&start);
        let release = Arc::clone(&release);
        let results = results_tx.clone();
        racers.push(thread::spawn(move || {
            start.wait();
            let election = runtime.try_elect_core();
            results
                .send(election.as_ref().map(|_| ()).map_err(|error| error.code()))
                .unwrap();
            release.wait();
            drop(election);
        }));
    }
    drop(results_tx);

    start.wait();
    let results = results_rx.iter().collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(
        results
            .iter()
            .filter(|result| result.is_err())
            .all(|result| { *result == Err(WindowsIpcErrorCode::CoreAlreadyRunning) })
    );

    release.wait();
    for racer in racers {
        racer.join().unwrap();
    }
}

#[test]
fn first_pipe_instance_prevents_a_second_listener() {
    let runtime = WindowsRuntime::current(InstallChannel::Development).unwrap();
    let _first = runtime.bind_after_election(EndpointRole::Browser).unwrap();
    let error = runtime
        .bind_after_election(EndpointRole::Browser)
        .unwrap_err();
    assert_eq!(error.code(), WindowsIpcErrorCode::EndpointInUse);
}

#[tokio::test]
async fn authenticates_the_client_before_reading_a_bounded_frame() {
    let runtime = WindowsRuntime::current(InstallChannel::Production).unwrap();
    let pipe_name = runtime.pipe_name(EndpointRole::Mcp);
    let listener = runtime.bind_after_election(EndpointRole::Mcp).unwrap();
    let (completed_tx, completed_rx) = mpsc::sync_channel(1);

    let server = thread::spawn(move || {
        let mut stream = listener.accept_authenticated().unwrap();
        assert!(
            firehazard::open_thread_token(
                firehazard::get_current_thread(),
                firehazard::token::QUERY,
                true,
            )
            .is_err(),
            "client impersonation must be reverted before parsing"
        );
        completed_tx.send(stream.read_json().unwrap()).unwrap();
    });

    let mut client = ClientOptions::new().open(&pipe_name).unwrap();
    write_json_frame(&mut client, br#"{"type":"test"}"#)
        .await
        .unwrap();
    drop(client);

    assert_eq!(
        completed_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("authenticated server read must complete"),
        Some(br#"{"type":"test"}"#.to_vec())
    );
    server.join().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bridge_core_rejects_a_second_owner_and_restarts_with_a_fresh_epoch() {
    let runtime = WindowsRuntime::current(InstallChannel::Production).unwrap();
    let first = WindowsBridgeCore::start(runtime.clone()).unwrap();
    let first_epoch = first.epoch().clone();

    let error = WindowsBridgeCore::start(runtime.clone()).unwrap_err();
    assert_eq!(error.code(), "core_already_running");
    assert!(matches!(
        error,
        BridgeCoreError::Transport(error)
            if error.code() == WindowsIpcErrorCode::CoreAlreadyRunning
    ));

    drop(first);
    let restarted = WindowsBridgeCore::start(runtime).unwrap();
    assert_ne!(restarted.epoch(), &first_epoch);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bridge_core_counts_peers_and_rejects_malformed_frames() {
    let runtime = WindowsRuntime::current(InstallChannel::Development).unwrap();
    let core = WindowsBridgeCore::start(runtime.clone()).unwrap();
    let mut core_task = tokio::spawn(core.run(Duration::from_millis(75), CancellationToken::new()));
    let browser = open_client(&runtime.pipe_name(EndpointRole::Browser)).await;
    let mut mcp = open_client(&runtime.pipe_name(EndpointRole::Mcp)).await;

    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!core_task.is_finished());

    drop(browser);
    tokio::time::sleep(Duration::from_millis(125)).await;
    assert!(!core_task.is_finished());

    let malformed = br#"{"value":1,"value":2}"#;
    mcp.write_all(&u32::try_from(malformed.len()).unwrap().to_le_bytes())
        .await
        .unwrap();
    mcp.write_all(malformed).await.unwrap();
    assert_peer_closed(&mut mcp, Duration::from_secs(2)).await;

    let reason = timeout(Duration::from_secs(2), &mut core_task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(reason, CoreStopReason::Idle);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bridge_core_times_out_a_stalled_partial_frame() {
    let runtime = WindowsRuntime::current(InstallChannel::Development).unwrap();
    let core = WindowsBridgeCore::start(runtime.clone()).unwrap();
    let shutdown = CancellationToken::new();
    let core_task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
    let mut browser = open_client(&runtime.pipe_name(EndpointRole::Browser)).await;

    browser.write_all(&[1]).await.unwrap();
    assert_peer_closed(&mut browser, Duration::from_secs(7)).await;

    shutdown.cancel();
    assert_eq!(
        timeout(Duration::from_secs(2), core_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        CoreStopReason::Shutdown
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bridge_core_rejects_sessions_beyond_the_per_role_worker_bound() {
    const SESSION_LIMIT: usize = 8;
    let runtime = WindowsRuntime::current(InstallChannel::Development).unwrap();
    let core = WindowsBridgeCore::start(runtime.clone()).unwrap();
    let shutdown = CancellationToken::new();
    let core_task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));
    let pipe_name = runtime.pipe_name(EndpointRole::Browser);
    let mut retained = Vec::with_capacity(SESSION_LIMIT);

    for _ in 0..SESSION_LIMIT {
        retained.push(open_client(&pipe_name).await);
    }
    tokio::time::sleep(Duration::from_millis(200)).await;

    let mut rejected = open_client(&pipe_name).await;
    assert_peer_closed(&mut rejected, Duration::from_secs(2)).await;
    assert!(!core_task.is_finished());

    drop(retained);
    shutdown.cancel();
    assert_eq!(
        timeout(Duration::from_secs(2), core_task)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        CoreStopReason::Shutdown
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bridge_core_shutdown_stops_workers_and_releases_election() {
    let runtime = WindowsRuntime::current(InstallChannel::Production).unwrap();
    let core = WindowsBridgeCore::start(runtime.clone()).unwrap();
    let shutdown = CancellationToken::new();
    let core_task = tokio::spawn(core.run(Duration::from_secs(60), shutdown.clone()));

    shutdown.cancel();
    let reason = timeout(Duration::from_secs(2), core_task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(reason, CoreStopReason::Shutdown);

    WindowsBridgeCore::start(runtime).unwrap();
}

async fn open_client(pipe_name: &str) -> NamedPipeClient {
    timeout(Duration::from_secs(2), async {
        loop {
            match ClientOptions::new().open(pipe_name) {
                Ok(client) => return client,
                Err(_) => tokio::time::sleep(Duration::from_millis(10)).await,
            }
        }
    })
    .await
    .expect("core pipe must become connectable")
}

async fn assert_peer_closed(client: &mut NamedPipeClient, within: Duration) {
    let mut byte = [0_u8; 1];
    match timeout(within, client.read(&mut byte)).await {
        Ok(Ok(0)) => {}
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::BrokenPipe => {}
        Ok(other) => panic!("expected closed pipe, got {other:?}"),
        Err(_) => panic!("pipe did not close within the deterministic bound"),
    }
}
