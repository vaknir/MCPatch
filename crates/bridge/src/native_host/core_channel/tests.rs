use std::time::Duration;

use tokio::{
    io::AsyncWriteExt,
    net::UnixStream,
    time::{sleep, timeout},
};

use super::*;
use crate::{
    local_ipc::{AuthenticatedUnixStream, read_json_frame},
    protocol::{Heartbeat, PROTOCOL_VERSION},
};

#[tokio::test]
async fn outbound_write_does_not_cancel_a_partial_inbound_frame() {
    let (adapter, mut core) = UnixStream::pair().unwrap();
    let expected_uid = adapter.peer_cred().unwrap().uid();
    let connection = LocalCoreConnection::from(
        AuthenticatedUnixStream::authenticate(adapter, expected_uid).unwrap(),
    );
    let channel = CoreLocalBrowserChannel::new(connection);

    let inbound = heartbeat("from-core");
    let payload = serde_json::to_vec(&inbound).unwrap();
    let header = u32::try_from(payload.len()).unwrap().to_le_bytes();
    core.write_all(&header[..2]).await.unwrap();
    sleep(Duration::from_millis(10)).await;

    let outbound = heartbeat("from-browser");
    channel.send(outbound.clone()).await.unwrap();
    assert_eq!(
        parse_message(
            &timeout(Duration::from_secs(1), read_json_frame(&mut core))
                .await
                .unwrap()
                .unwrap()
                .unwrap(),
        )
        .unwrap(),
        outbound
    );

    core.write_all(&header[2..]).await.unwrap();
    core.write_all(&payload).await.unwrap();
    assert_eq!(
        timeout(Duration::from_secs(1), channel.receive())
            .await
            .unwrap()
            .unwrap(),
        Some(inbound)
    );
    channel.close().await.unwrap();
}

fn heartbeat(id: &str) -> Message {
    Message::Heartbeat(Heartbeat {
        protocol_version: PROTOCOL_VERSION,
        heartbeat_id: id.into(),
        sent_at: "2026-09-15T00:00:00Z".into(),
    })
}
