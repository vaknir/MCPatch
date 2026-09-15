#![cfg(windows)]

use std::{sync::mpsc, thread, time::Duration};

use mcpatch_bridge::local_ipc::{
    EndpointRole, InstallChannel, WindowsIpcErrorCode, WindowsRuntime, write_json_frame,
};
use tokio::net::windows::named_pipe::ClientOptions;

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
