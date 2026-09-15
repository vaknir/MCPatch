#![cfg(unix)]

use std::{
    fs::{self, DirBuilder, OpenOptions},
    os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use mcpatch_bridge::local_ipc::{
    EndpointRole, InstallChannel, LocalCoreConnectionErrorCode, LocalFrameErrorCode, LocalRuntime,
    MAX_LOCAL_IPC_FRAME_BYTES, UnixIpcErrorCode, UnixRuntime, read_json_frame, write_json_frame,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn local_frames_are_little_endian_bounded_json() {
    let payload = br#"{"ok":true}"#;
    let (mut writer, mut reader) = tokio::io::duplex(128);
    write_json_frame(&mut writer, payload).await.unwrap();

    let mut header = [0_u8; 4];
    reader.read_exact(&mut header).await.unwrap();
    assert_eq!(u32::from_le_bytes(header), payload.len() as u32);
    let mut actual = vec![0_u8; payload.len()];
    reader.read_exact(&mut actual).await.unwrap();
    assert_eq!(actual, payload);

    let (mut writer, mut reader) = tokio::io::duplex(128);
    writer
        .write_all(&u32::try_from(payload.len()).unwrap().to_le_bytes())
        .await
        .unwrap();
    writer.write_all(payload).await.unwrap();
    assert_eq!(read_json_frame(&mut reader).await.unwrap(), Some(actual));
}

#[tokio::test]
async fn local_frames_reject_limits_truncation_and_ambiguous_json() {
    assert_frame_error(&0_u32.to_le_bytes(), LocalFrameErrorCode::EmptyMessage).await;
    assert_frame_error(&[1, 2], LocalFrameErrorCode::TruncatedHeader).await;

    let mut truncated = 4_u32.to_le_bytes().to_vec();
    truncated.extend_from_slice(b"{}");
    assert_frame_error(&truncated, LocalFrameErrorCode::TruncatedPayload).await;

    let oversized = u32::try_from(MAX_LOCAL_IPC_FRAME_BYTES + 1)
        .unwrap()
        .to_le_bytes();
    assert_frame_error(&oversized, LocalFrameErrorCode::MessageTooLarge).await;

    let duplicate = br#"{"value":1,"value":2}"#;
    let mut duplicate_frame = u32::try_from(duplicate.len())
        .unwrap()
        .to_le_bytes()
        .to_vec();
    duplicate_frame.extend_from_slice(duplicate);
    assert_frame_error(&duplicate_frame, LocalFrameErrorCode::InvalidJson).await;

    let mut sink = tokio::io::sink();
    let invalid = write_json_frame(&mut sink, b"not-json").await.unwrap_err();
    assert_eq!(invalid.code(), LocalFrameErrorCode::InvalidJson);

    let oversized_payload = vec![b' '; MAX_LOCAL_IPC_FRAME_BYTES + 1];
    let oversized_output = write_json_frame(&mut sink, &oversized_payload)
        .await
        .unwrap_err();
    assert_eq!(
        oversized_output.code(),
        LocalFrameErrorCode::MessageTooLarge
    );
}

#[tokio::test]
async fn runtime_directory_and_role_endpoints_are_private() {
    let fixture = TestDirectory::new(0o700);
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let production = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Production)
        .await
        .unwrap();

    let metadata = fs::symlink_metadata(runtime.directory()).unwrap();
    assert!(metadata.file_type().is_dir());
    assert_eq!(metadata.mode() & 0o777, 0o700);
    assert_eq!(metadata.uid(), runtime.expected_uid());
    assert_ne!(runtime.directory(), production.directory());
    assert_ne!(
        runtime.socket_path(EndpointRole::Browser),
        runtime.socket_path(EndpointRole::Mcp)
    );
    assert!(
        runtime
            .socket_path(EndpointRole::Browser)
            .ends_with("browser-v1.sock")
    );
    assert!(
        runtime
            .socket_path(EndpointRole::Mcp)
            .ends_with("mcp-v1.sock")
    );
}

#[tokio::test]
async fn rejects_unsafe_runtime_directories_without_following_symlinks() {
    let permissive = TestDirectory::new(0o755);
    let error = UnixRuntime::prepare_at(permissive.path(), InstallChannel::Development)
        .await
        .unwrap_err();
    assert_eq!(error.code(), UnixIpcErrorCode::UnsafeRuntimeDirectory);

    let fixture = TestDirectory::new(0o700);
    let target = fixture.path().join("redirected");
    create_directory(&target, 0o700);
    std::os::unix::fs::symlink(&target, fixture.path().join("mcpatch")).unwrap();
    let error = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap_err();
    assert_eq!(error.code(), UnixIpcErrorCode::UnsafeRuntimeDirectory);
}

#[tokio::test]
async fn authenticates_same_user_peers_before_exchanging_frames() {
    let fixture = TestDirectory::new(0o700);
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let election = runtime.try_elect_core().unwrap();
    let listener = runtime
        .bind_after_election(&election, EndpointRole::Browser)
        .await
        .unwrap();
    let socket_path = runtime.socket_path(EndpointRole::Browser).to_owned();

    let metadata = fs::symlink_metadata(&socket_path).unwrap();
    assert!(metadata.file_type().is_socket());
    assert_eq!(metadata.mode() & 0o777, 0o600);
    assert_eq!(metadata.uid(), runtime.expected_uid());

    let (accepted, client) = tokio::join!(
        listener.accept_authenticated(),
        runtime.connect(EndpointRole::Browser)
    );
    let mut accepted = accepted.unwrap();
    let mut client = client.unwrap();
    assert_eq!(accepted.peer_uid(), runtime.expected_uid());
    assert_eq!(client.peer_uid(), runtime.expected_uid());

    client.write_json(br#"{"type":"test"}"#).await.unwrap();
    assert_eq!(
        accepted.read_json().await.unwrap(),
        Some(br#"{"type":"test"}"#.to_vec())
    );

    drop(listener);
    assert!(!socket_path.exists());
}

#[tokio::test]
async fn adapter_connection_exchanges_bounded_frames_with_the_selected_role() {
    let fixture = TestDirectory::new(0o700);
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let election = runtime.try_elect_core().unwrap();
    let listener = runtime
        .bind_after_election(&election, EndpointRole::Browser)
        .await
        .unwrap();
    let adapter_runtime = LocalRuntime::from(runtime);

    let (accepted, connection) = tokio::join!(
        listener.accept_authenticated(),
        adapter_runtime.connect(EndpointRole::Browser)
    );
    let mut accepted = accepted.unwrap();
    let mut connection = connection.unwrap();

    connection.send_json(br#"{"type":"hello"}"#).await.unwrap();
    assert_eq!(
        accepted.read_json().await.unwrap(),
        Some(br#"{"type":"hello"}"#.to_vec())
    );
    accepted
        .write_json(br#"{"type":"hello_ack"}"#)
        .await
        .unwrap();
    assert_eq!(
        connection.receive_json().await.unwrap(),
        Some(br#"{"type":"hello_ack"}"#.to_vec())
    );
}

#[tokio::test]
async fn adapter_connection_classifies_unavailable_and_malformed_peers() {
    let fixture = TestDirectory::new(0o700);
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let adapter_runtime = LocalRuntime::from(runtime.clone());

    let unavailable = adapter_runtime
        .connect(EndpointRole::Mcp)
        .await
        .unwrap_err();
    assert_eq!(
        unavailable.code(),
        LocalCoreConnectionErrorCode::Unavailable
    );
    assert_eq!(unavailable.code().as_str(), "local_core_unavailable");

    let path = runtime.socket_path(EndpointRole::Mcp);
    let listener = tokio::net::UnixListener::bind(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let (accepted, connection) = tokio::join!(
        listener.accept(),
        adapter_runtime.connect(EndpointRole::Mcp)
    );
    let (mut accepted, _) = accepted.unwrap();
    let mut connection = connection.unwrap();
    let duplicate = br#"{"value":1,"value":2}"#;
    accepted
        .write_all(&u32::try_from(duplicate.len()).unwrap().to_le_bytes())
        .await
        .unwrap();
    accepted.write_all(duplicate).await.unwrap();

    let malformed = connection.receive_json().await.unwrap_err();
    assert_eq!(
        malformed.code(),
        LocalCoreConnectionErrorCode::MalformedFrame
    );
}

#[tokio::test]
async fn detects_live_listener_and_reclaims_only_safe_stale_socket() {
    let fixture = TestDirectory::new(0o700);
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let election = runtime.try_elect_core().unwrap();
    let path = runtime.socket_path(EndpointRole::Browser).to_owned();
    let first = runtime
        .bind_after_election(&election, EndpointRole::Browser)
        .await
        .unwrap();

    let error = runtime
        .bind_after_election(&election, EndpointRole::Browser)
        .await
        .unwrap_err();
    assert_eq!(error.code(), UnixIpcErrorCode::EndpointInUse);
    drop(first);

    let stale = tokio::net::UnixListener::bind(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    drop(stale);
    assert!(path.exists());

    let replacement = runtime
        .bind_after_election(&election, EndpointRole::Browser)
        .await
        .unwrap();
    assert!(path.exists());
    drop(replacement);
    assert!(!path.exists());
}

#[tokio::test]
async fn refuses_unsafe_endpoint_and_preserves_replacement_on_cleanup() {
    let fixture = TestDirectory::new(0o700);
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let election = runtime.try_elect_core().unwrap();
    let path = runtime.socket_path(EndpointRole::Browser).to_owned();

    fs::write(&path, b"not a socket").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let error = runtime
        .bind_after_election(&election, EndpointRole::Browser)
        .await
        .unwrap_err();
    assert_eq!(error.code(), UnixIpcErrorCode::UnsafeEndpoint);
    assert_eq!(fs::read(&path).unwrap(), b"not a socket");

    fs::remove_file(&path).unwrap();
    let listener = runtime
        .bind_after_election(&election, EndpointRole::Browser)
        .await
        .unwrap();
    fs::remove_file(&path).unwrap();
    fs::write(&path, b"replacement").unwrap();
    drop(listener);
    assert_eq!(fs::read(&path).unwrap(), b"replacement");
}

#[tokio::test]
async fn endpoint_binding_requires_the_exact_channel_election() {
    let fixture = TestDirectory::new(0o700);
    let development = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();
    let production = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Production)
        .await
        .unwrap();
    let development_election = development.try_elect_core().unwrap();

    let error = production
        .bind_after_election(&development_election, EndpointRole::Browser)
        .await
        .unwrap_err();

    assert_eq!(error.code(), UnixIpcErrorCode::UnsafeLock);
    assert!(!production.socket_path(EndpointRole::Browser).exists());
}

#[tokio::test]
async fn core_election_is_private_exclusive_and_recovers_after_release() {
    let fixture = TestDirectory::new(0o700);
    let runtime = UnixRuntime::prepare_at(fixture.path(), InstallChannel::Development)
        .await
        .unwrap();

    let election = runtime.try_elect_core().unwrap();
    let metadata = fs::symlink_metadata(runtime.core_lock_path()).unwrap();
    assert!(metadata.file_type().is_file());
    assert_eq!(metadata.mode() & 0o777, 0o600);
    assert_eq!(metadata.uid(), runtime.expected_uid());
    assert_eq!(metadata.nlink(), 1);

    let error = runtime.try_elect_core().unwrap_err();
    assert_eq!(error.code(), UnixIpcErrorCode::CoreAlreadyRunning);

    drop(election);
    runtime.try_elect_core().unwrap();
}

#[tokio::test]
async fn core_election_rejects_unsafe_lock_nodes() {
    let permissive_fixture = TestDirectory::new(0o700);
    let permissive_runtime =
        UnixRuntime::prepare_at(permissive_fixture.path(), InstallChannel::Development)
            .await
            .unwrap();
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o644)
        .open(permissive_runtime.core_lock_path())
        .unwrap();
    let error = permissive_runtime.try_elect_core().unwrap_err();
    assert_eq!(error.code(), UnixIpcErrorCode::UnsafeLock);

    let symlink_fixture = TestDirectory::new(0o700);
    let symlink_runtime =
        UnixRuntime::prepare_at(symlink_fixture.path(), InstallChannel::Development)
            .await
            .unwrap();
    let target = symlink_fixture.path().join("target");
    fs::write(&target, b"preserve me").unwrap();
    std::os::unix::fs::symlink(&target, symlink_runtime.core_lock_path()).unwrap();
    let error = symlink_runtime.try_elect_core().unwrap_err();
    assert_eq!(error.code(), UnixIpcErrorCode::UnsafeLock);
    assert_eq!(fs::read(target).unwrap(), b"preserve me");
}

async fn assert_frame_error(frame: &[u8], expected: LocalFrameErrorCode) {
    let (mut writer, mut reader) = tokio::io::duplex(frame.len().max(1));
    writer.write_all(frame).await.unwrap();
    drop(writer);
    let error = read_json_frame(&mut reader).await.unwrap_err();
    assert_eq!(error.code(), expected);
}

static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(mode: u32) -> Self {
        let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .subsec_nanos();
        // macOS limits Unix socket paths to roughly 104 bytes. Keep the fixture
        // base short enough to leave room for MCPatch's fixed child names.
        let path = std::env::temp_dir().join(format!(
            "m{:x}{sequence:x}{:04x}",
            process::id(),
            timestamp & 0xffff
        ));
        create_directory(&path, mode);
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn create_directory(path: &Path, mode: u32) {
    let mut builder = DirBuilder::new();
    builder.mode(mode).create(path).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}
