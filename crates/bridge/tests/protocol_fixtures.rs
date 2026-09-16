use std::{fs, path::PathBuf};

use mcpatch_bridge::protocol::{MAX_MESSAGE_BYTES, Message, ParseMessageError, parse_message};

fn fixture_directory(kind: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/v2")
        .join(kind)
}

fn fixture_paths(kind: &str) -> Vec<PathBuf> {
    let mut paths = fs::read_dir(fixture_directory(kind))
        .expect("fixture directory must exist")
        .map(|entry| entry.expect("fixture entry must be readable").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

#[test]
fn accepts_all_valid_protocol_fixtures() {
    let paths = fixture_paths("valid");
    assert!(!paths.is_empty());

    for path in paths {
        let bytes = fs::read(&path).expect("fixture must be readable");
        parse_message(&bytes).unwrap_or_else(|error| {
            panic!("valid fixture {} was rejected: {error}", path.display())
        });
    }
}

#[test]
fn rejects_all_invalid_protocol_fixtures() {
    let paths = fixture_paths("invalid");
    assert!(!paths.is_empty());

    for path in paths {
        let bytes = fs::read(&path).expect("fixture must be readable");
        assert!(
            parse_message(&bytes).is_err(),
            "invalid fixture {} was accepted",
            path.display()
        );
    }
}

#[test]
fn rejects_oversized_messages_before_json_parsing() {
    let bytes = vec![b' '; MAX_MESSAGE_BYTES + 1];
    let error = parse_message(&bytes).expect_err("oversized input must fail");
    assert!(matches!(error, ParseMessageError::MessageTooLarge { .. }));
}

#[test]
fn rejects_duplicate_known_fields() {
    let bytes = br#"{
        "protocolVersion": 1,
        "type": "cancel",
        "requestId": "request-1",
        "requestId": "request-2"
    }"#;
    let error = parse_message(bytes).expect_err("duplicate fields must fail");
    assert!(matches!(error, ParseMessageError::Json(_)));
}

#[test]
fn rejects_duplicate_keys_inside_tool_arguments() {
    let bytes = br#"{
        "protocolVersion": 1,
        "type": "tool_call",
        "requestId": "request-1",
        "contextId": "tab-42",
        "contextRevision": 3,
        "origin": "https://example.com",
        "tool": "example.write",
        "args": {"value": "approved", "value": "substituted"}
    }"#;
    let error = parse_message(bytes).expect_err("nested duplicate keys must fail");
    assert!(matches!(error, ParseMessageError::Json(_)));
}

#[test]
fn round_trips_every_valid_message() {
    for path in fixture_paths("valid") {
        let bytes = fs::read(&path).expect("fixture must be readable");
        let message = parse_message(&bytes).expect("valid fixture must parse");
        let encoded = serde_json::to_vec(&message).expect("message must serialize");
        let decoded: Message = parse_message(&encoded).expect("serialized message must parse");
        assert_eq!(decoded, message, "round trip failed for {}", path.display());
    }
}
