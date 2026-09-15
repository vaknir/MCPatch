#![cfg(windows)]

use std::thread;

use mcpatch_bridge::local_ipc::{
    EndpointRole, InstallChannel, WindowsIpcErrorCode, WindowsRuntime, write_json_frame,
};
use tokio::{io::AsyncWriteExt as _, net::windows::named_pipe::ClientOptions};

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
        stream.read_json().unwrap()
    });

    let mut client = ClientOptions::new().open(&pipe_name).unwrap();
    write_json_frame(&mut client, br#"{"type":"test"}"#)
        .await
        .unwrap();
    client.shutdown().await.unwrap();

    assert_eq!(server.join().unwrap(), Some(br#"{"type":"test"}"#.to_vec()));
}
