use std::{fs, path::PathBuf};

use mcpatch_bridge::protocol::{
    AcceptorNegotiation, Cancel, Hello, Implementation, Message, NegotiationCode, NegotiationEvent,
    NegotiationPhase, Role, parse_message, select_protocol_version, verify_selected_version,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Cases {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    local: Vec<u32>,
    remote: Vec<u32>,
    selected: Option<u32>,
    error: Option<String>,
}

#[test]
fn matches_shared_negotiation_cases() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/negotiation/cases.json");
    let bytes = fs::read(path).expect("negotiation fixture must be readable");
    let fixture: Cases = serde_json::from_slice(&bytes).expect("negotiation fixture must parse");

    for case in fixture.cases {
        match (case.selected, case.error.as_deref()) {
            (Some(expected), None) => assert_eq!(
                select_protocol_version(&case.local, &case.remote),
                Ok(expected),
                "{}",
                case.name
            ),
            (None, Some(expected)) => {
                let error = select_protocol_version(&case.local, &case.remote)
                    .expect_err("case must fail negotiation");
                assert_eq!(code_name(error.code), expected, "{}", case.name);
            }
            _ => panic!("case {} must declare one expected outcome", case.name),
        }
    }
}

#[test]
fn rejects_downgraded_or_unoffered_acknowledgements() {
    assert_eq!(verify_selected_version(&[1, 2], &[1, 2], 2), Ok(()));
    assert_eq!(
        verify_selected_version(&[1, 2], &[1, 2], 1)
            .expect_err("lower common version is a downgrade")
            .code,
        NegotiationCode::UnexpectedSelectedVersion
    );
    assert_eq!(
        verify_selected_version(&[1], &[1], 2)
            .expect_err("unoffered version must fail")
            .code,
        NegotiationCode::UnexpectedSelectedVersion
    );
}

#[test]
fn verifies_the_selection_against_the_acceptor_set_carried_by_hello_ack() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/v2/valid/hello-ack.json");
    let bytes = fs::read(path).expect("hello acknowledgement fixture must be readable");
    let Message::HelloAck(acknowledgement) =
        parse_message(&bytes).expect("hello acknowledgement fixture must parse")
    else {
        panic!("fixture must be hello_ack");
    };

    assert_eq!(
        verify_selected_version(
            &[2],
            &acknowledgement.supported_protocol_versions,
            acknowledgement.selected_protocol_version,
        ),
        Ok(())
    );
    assert_eq!(
        verify_selected_version(&[1, 2], &[1, 2], 1)
            .expect_err("lower common version is a downgrade")
            .code,
        NegotiationCode::UnexpectedSelectedVersion
    );
    assert_eq!(
        verify_selected_version(&[1], &[1], 2)
            .expect_err("unadvertised selection must fail")
            .code,
        NegotiationCode::UnexpectedSelectedVersion
    );
}

#[test]
fn gates_application_messages_until_hello() {
    let mut negotiation = AcceptorNegotiation::new(vec![1]).expect("local versions are valid");
    let cancel = Message::Cancel(Cancel {
        protocol_version: 1,
        request_id: "request-1".to_owned(),
    });
    assert_eq!(
        negotiation
            .receive(&cancel)
            .expect_err("application message before hello must fail")
            .code,
        NegotiationCode::UnexpectedMessage
    );
    assert_eq!(negotiation.phase(), NegotiationPhase::Failed);
}

#[test]
fn accepts_messages_after_selecting_a_version() {
    let mut negotiation = AcceptorNegotiation::new(vec![1]).expect("local versions are valid");
    let hello = Message::Hello(Hello {
        protocol_version: 1,
        role: Role::Extension,
        supported_protocol_versions: vec![1],
        implementation: Implementation {
            name: "mcpatch-extension".to_owned(),
            version: "0.1.0".to_owned(),
        },
    });
    assert_eq!(
        negotiation.receive(&hello),
        Ok(NegotiationEvent::SendHelloAck {
            selected_protocol_version: 1
        })
    );
    assert_eq!(
        negotiation.phase(),
        NegotiationPhase::AckPending {
            protocol_version: 1
        }
    );
    negotiation
        .acknowledgement_sent()
        .expect("sent acknowledgement makes the connection ready");
    assert_eq!(
        negotiation.phase(),
        NegotiationPhase::Ready {
            protocol_version: 1
        }
    );

    let cancel = Message::Cancel(Cancel {
        protocol_version: 1,
        request_id: "request-1".to_owned(),
    });
    assert_eq!(
        negotiation.receive(&cancel),
        Ok(NegotiationEvent::MessageAccepted)
    );
}

#[test]
fn gates_messages_until_acknowledgement_is_sent() {
    let mut negotiation = AcceptorNegotiation::new(vec![1]).expect("local versions are valid");
    let hello = Message::Hello(Hello {
        protocol_version: 1,
        role: Role::Extension,
        supported_protocol_versions: vec![1],
        implementation: Implementation {
            name: "mcpatch-extension".to_owned(),
            version: "0.1.0".to_owned(),
        },
    });
    negotiation
        .receive(&hello)
        .expect("hello selects a protocol version");

    let cancel = Message::Cancel(Cancel {
        protocol_version: 1,
        request_id: "request-1".to_owned(),
    });
    assert_eq!(
        negotiation
            .receive(&cancel)
            .expect_err("message before acknowledgement delivery must fail")
            .code,
        NegotiationCode::UnexpectedMessage
    );
    assert_eq!(negotiation.phase(), NegotiationPhase::Failed);
}

fn code_name(code: NegotiationCode) -> &'static str {
    match code {
        NegotiationCode::InvalidVersionSet => "INVALID_VERSION_SET",
        NegotiationCode::NoCommonVersion => "NO_COMMON_VERSION",
        NegotiationCode::UnexpectedSelectedVersion => "UNEXPECTED_SELECTED_VERSION",
        NegotiationCode::UnexpectedMessage => "UNEXPECTED_MESSAGE",
        NegotiationCode::VersionMismatch => "VERSION_MISMATCH",
        NegotiationCode::NegotiationFailed => "NEGOTIATION_FAILED",
    }
}
