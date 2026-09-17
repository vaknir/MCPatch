//! Security regression suite for the real `mcpatch mcp-stdio` executable.
//!
//! Each test drives the shipped binary over stdio exactly as an MCP client
//! would, with logging at `trace`, and pins a property the red-team pass
//! verified by hand: hostile bytes never leave the bridge, frame abuse ends
//! the session with a stable code instead of a crash, continuation state is
//! refused, concurrency is bounded without starvation, and version
//! negotiation lands where the bridge expects. A browser peer is attached
//! through the same local IPC the extension uses, so calls exercise the full
//! core routing path rather than a mock registry.
#![cfg(unix)]

mod stdio_support;

use std::{collections::BTreeSet, time::Duration};

use mcpatch_bridge::{
    local_ipc::{AuthenticatedUnixStream, EndpointRole, InstallChannel, UnixRuntime},
    mcp::MAX_MCP_MESSAGE_BYTES,
    protocol::{Hello, Implementation, Message, PROTOCOL_VERSION, Role, ToolResult, parse_message},
};
use serde_json::{Value, json};
use stdio_support::{
    PROCESS_TIMEOUT, TestDirectory, assert_json_lines, bridge_command, finish, read_json_line,
    write_bytes_until_closed, write_json_line,
};
use tokio::{
    io::BufReader,
    process::{Child, ChildStdout},
    time::timeout,
};

const DEMO_SNAPSHOT: &[u8] =
    include_bytes!("../../../packages/protocol/fixtures/v2/valid/demo-capability-snapshot.json");
const DEMO_TOOL: &str = "mcpatch.demo.status";
const NAME_CANARY: &str = "CANARY-TOOL-NAME-7f3a";
const KEY_CANARY: &str = "CANARY-ARG-KEY-b41c";
const VALUE_CANARY: &str = "CANARY-ARG-VALUE-9e02";
const CLIENT_CANARY: &str = "CANARY-CLIENT-NAME-55d1";
const FRAME_CANARY: &str = "CANARY-FRAME-c0de";
/// Window in which a rejected call would have reached the browser if the
/// rejection had not happened first.
const NO_DISPATCH_WINDOW: Duration = Duration::from_millis(150);
/// Below the browser session's bounded outbound queue, so every call in the
/// batch can be reserved and dispatched before any completes without the core
/// closing the session for transport backpressure. This proves concurrent
/// handling and the absence of starvation; the per-connection reservation and
/// snapshot ceilings are unit-tested separately.
const CONCURRENT_CALLS: usize = 12;

#[tokio::test]
async fn hostile_tool_names_and_arguments_never_reach_stdout_or_stderr() {
    let mut session = Session::start_with_browser().await;

    let unknown = session
        .call(30, &format!("mcpatch.{NAME_CANARY}.missing"), json!({}))
        .await;
    assert_eq!(unknown["error"]["code"], -32602);
    assert_eq!(unknown["error"]["message"], "Tool is unavailable");

    let extra = session
        .call(31, DEMO_TOOL, json!({ KEY_CANARY: VALUE_CANARY }))
        .await;
    assert_eq!(extra["error"]["code"], -32602);
    assert_eq!(
        extra["error"]["message"],
        "Tool arguments failed schema validation"
    );

    for (id, arguments) in [
        (32, json!({ "__proto__": { "polluted": VALUE_CANARY } })),
        (33, json!({ "constructor": { "prototype": VALUE_CANARY } })),
        (34, json!({ "prototype": VALUE_CANARY })),
    ] {
        let response = session.call(id, DEMO_TOOL, arguments).await;
        assert_eq!(response["error"]["code"], -32602, "id {id}");
    }
    session.assert_no_browser_dispatch().await;

    let (status, stdout, stderr) = session.finish().await;
    assert!(status.success());
    let stdout = String::from_utf8(stdout).unwrap();
    for canary in [NAME_CANARY, KEY_CANARY, VALUE_CANARY, CLIENT_CANARY] {
        assert!(!stdout.contains(canary), "stdout leaked {canary}");
        assert!(!stderr.contains(canary), "stderr leaked {canary}");
    }
    assert!(
        !stderr.contains(DEMO_TOOL),
        "tool names must stay out of logs"
    );
    assert!(!stderr.contains("__proto__"));
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn frame_abuse_ends_the_session_with_a_stable_code_and_no_echo() {
    let oversized = {
        let mut frame = FRAME_CANARY.as_bytes().to_vec();
        frame.resize(MAX_MCP_MESSAGE_BYTES * 5 / 2, b'x');
        frame
    };
    let deeply_nested = {
        let mut frame =
            format!(r#"{{"jsonrpc":"2.0","id":1,"method":"{FRAME_CANARY}","params":"#).into_bytes();
        frame.extend(std::iter::repeat_n(b'[', 200_000));
        frame
    };
    let cases: [(&str, Vec<u8>, &str); 5] = [
        ("oversized", oversized, "mcp_stdio_message_too_large"),
        ("deeply nested", deeply_nested, "mcp_stdio_invalid_message"),
        (
            "duplicate keys",
            format!(r#"{{"jsonrpc":"2.0","id":1,"id":2,"method":"{FRAME_CANARY}"}}"#).into_bytes(),
            "mcp_stdio_invalid_message",
        ),
        (
            "invalid UTF-8",
            [
                format!(r#"{{"jsonrpc":"2.0","id":1,"method":"{FRAME_CANARY}"#).as_bytes(),
                &[0xff, 0xfe, b'"', b'}'],
            ]
            .concat(),
            "mcp_stdio_read_failed",
        ),
        (
            "out-of-range id",
            format!(r#"{{"jsonrpc":"2.0","id":1e309,"method":"{FRAME_CANARY}"}}"#).into_bytes(),
            "mcp_stdio_invalid_message",
        ),
    ];

    for (label, frame, expected_code) in cases {
        let mut session = Session::start().await;
        write_bytes_until_closed(&mut session.child, &frame).await;
        write_bytes_until_closed(&mut session.child, b"\n").await;

        let (status, stdout, stderr) = session.finish().await;
        assert!(!status.success(), "{label}: session must end");
        assert_eq!(
            status.code(),
            Some(1),
            "{label}: exit must be a plain failure"
        );
        assert!(
            stdout.is_empty(),
            "{label}: nothing may follow the initialize response"
        );
        assert!(
            stderr.contains(&format!(r#""code":"{expected_code}""#)),
            "{label}: expected {expected_code} in {stderr}"
        );
        assert!(!stderr.contains(FRAME_CANARY), "{label}: log echoed input");
        assert!(!stderr.contains("panicked"), "{label}: bridge panicked");
        assert!(stderr.len() < 16 * 1024, "{label}: log is not bounded");
        assert_json_lines(&stderr);
    }
}

#[tokio::test]
async fn continuation_state_is_refused_before_routing() {
    let mut session = Session::start_with_browser().await;

    // rmcp serializes `CallToolRequestParams` in camelCase, so these are the
    // wire names a 2026-07-28 client would send.
    for (id, extra) in [
        (40, json!({ "requestState": VALUE_CANARY })),
        (41, json!({ "inputResponses": { "field": VALUE_CANARY } })),
    ] {
        let mut params = json!({ "name": DEMO_TOOL, "arguments": {} });
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let response = session.request(id, "tools/call", params).await;
        assert_eq!(response["error"]["code"], -32602, "id {id}");
        assert_eq!(
            response["error"]["message"],
            "MCPatch does not accept tool-call continuation state"
        );
    }
    session.assert_no_browser_dispatch().await;

    let (status, _, stderr) = session.finish().await;
    assert!(status.success());
    assert!(!stderr.contains(VALUE_CANARY));
}

#[tokio::test]
async fn concurrent_calls_are_answered_exactly_once_without_starvation() {
    let mut session = Session::start_with_browser().await;
    let first_id = 1_000_u64;

    // Reserve and dispatch every call before answering any, so all of them are
    // genuinely in flight at once.
    for offset in 0..CONCURRENT_CALLS as u64 {
        session
            .send(
                first_id + offset,
                "tools/call",
                json!({ "name": DEMO_TOOL, "arguments": {} }),
            )
            .await;
    }
    let mut calls = Vec::with_capacity(CONCURRENT_CALLS);
    for _ in 0..CONCURRENT_CALLS {
        let frame = read_browser_bytes(session.browser()).await;
        let message = parse_message(&frame).unwrap();
        assert!(matches!(message, Message::ToolCall(_)));
        calls.push(message);
    }

    // Answer in reverse so a completion order tied to arrival would show up as
    // a starved or misrouted response.
    for call in calls.into_iter().rev() {
        session.answer_tool_call(call).await;
    }

    let mut answered = BTreeSet::new();
    for _ in 0..CONCURRENT_CALLS {
        let response = session.receive().await;
        assert_eq!(
            response["result"]["structuredContent"],
            json!({ "status": "ready" }),
            "every concurrent call must complete: {response}"
        );
        assert!(
            answered.insert(response["id"].as_u64().unwrap()),
            "each id must be answered exactly once"
        );
    }
    assert_eq!(
        answered,
        (first_id..first_id + CONCURRENT_CALLS as u64).collect::<BTreeSet<_>>(),
        "no concurrent call may be starved"
    );

    let (status, _, stderr) = session.finish().await;
    assert!(status.success());
    assert_json_lines(&stderr);
}

#[tokio::test]
async fn newer_and_unknown_client_versions_negotiate_to_the_pinned_version() {
    for (client_version, expected) in [
        ("2025-11-25", "2025-11-25"),
        ("2026-07-28", "2025-11-25"),
        ("2099-01-01", "2025-11-25"),
    ] {
        let mut session = Session::spawn().await;
        let initialize = session
            .request(
                1,
                "initialize",
                json!({
                    "protocolVersion": client_version,
                    "capabilities": {},
                    "clientInfo": { "name": CLIENT_CANARY, "version": "0.1.0" }
                }),
            )
            .await;
        assert_eq!(
            initialize["result"]["protocolVersion"], expected,
            "client {client_version} must be answered with {expected}; an rmcp upgrade that changes negotiation must be reviewed"
        );
        assert_eq!(initialize["result"]["serverInfo"]["name"], "mcpatch");
        let (status, _, stderr) = session.finish().await;
        assert!(status.success());
        assert!(!stderr.contains(CLIENT_CANARY));
    }
}

/// One adapter process plus, optionally, one browser peer attached to the
/// core that the adapter elected.
struct Session {
    child: Child,
    stdout: BufReader<ChildStdout>,
    browser: Option<AuthenticatedUnixStream>,
    _directory: TestDirectory,
}

impl Session {
    /// Spawn the adapter without initializing it.
    async fn spawn() -> Self {
        let directory = TestDirectory::new();
        let mut child = bridge_command(directory.path())
            .spawn()
            .expect("bridge must spawn");
        let stdout = BufReader::new(child.stdout.take().expect("stdout must be piped"));
        Self {
            child,
            stdout,
            browser: None,
            _directory: directory,
        }
    }

    /// Spawn and complete the MCP handshake, which makes the adapter elect a
    /// bridge core under the private runtime directory.
    async fn start() -> Self {
        let mut session = Self::spawn().await;
        let initialize = session
            .request(
                1,
                "initialize",
                json!({
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": { "name": CLIENT_CANARY, "version": "0.1.0" }
                }),
            )
            .await;
        assert_eq!(initialize["id"], 1);
        assert_eq!(initialize["result"]["serverInfo"]["name"], "mcpatch");
        write_json_line(
            &mut session.child,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}"#,
        )
        .await;
        session
    }

    /// Start, then attach a browser peer that publishes the demo capability
    /// and wait until the adapter can list it.
    async fn start_with_browser() -> Self {
        let mut session = Self::start().await;
        let runtime =
            UnixRuntime::prepare_at(session._directory.path(), InstallChannel::Production)
                .await
                .expect("the adapter's runtime directory must be reusable");
        let mut browser = timeout(PROCESS_TIMEOUT, async {
            loop {
                match runtime.connect(EndpointRole::Browser).await {
                    Ok(stream) => break stream,
                    Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
                }
            }
        })
        .await
        .expect("browser endpoint must accept a peer");
        let hello = Message::Hello(Hello {
            protocol_version: PROTOCOL_VERSION,
            role: Role::Extension,
            supported_protocol_versions: vec![PROTOCOL_VERSION],
            implementation: Implementation {
                name: "mcpatch-extension".to_owned(),
                version: "0.1.0".to_owned(),
            },
        });
        browser
            .write_json(&serde_json::to_vec(&hello).unwrap())
            .await
            .unwrap();
        assert!(matches!(
            parse_message(&read_browser_bytes(&mut browser).await).unwrap(),
            Message::HelloAck(_)
        ));
        browser.write_json(DEMO_SNAPSHOT).await.unwrap();
        session.browser = Some(browser);

        timeout(PROCESS_TIMEOUT, async {
            for id in 100..200 {
                let response = session.request(id, "tools/list", json!({})).await;
                if response["result"]["tools"]
                    .as_array()
                    .is_some_and(|tools| tools.len() == 1)
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("demo tool did not become visible");
        })
        .await
        .unwrap();
        session
    }

    async fn send(&mut self, id: u64, method: &str, params: Value) {
        let request = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        write_json_line(&mut self.child, &serde_json::to_string(&request).unwrap()).await;
    }

    async fn receive(&mut self) -> Value {
        read_json_line(&mut self.stdout).await
    }

    async fn request(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.send(id, method, params).await;
        let response = self.receive().await;
        assert_eq!(response["id"], id);
        response
    }

    async fn call(&mut self, id: u64, tool: &str, arguments: Value) -> Value {
        self.request(
            id,
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
        )
        .await
    }

    async fn answer_tool_call(&mut self, message: Message) {
        let Message::ToolCall(call) = message else {
            panic!("only tool calls can be answered");
        };
        let result = Message::ToolResult(ToolResult {
            protocol_version: PROTOCOL_VERSION,
            request_id: call.request_id,
            context_id: call.context_id,
            context_revision: call.context_revision,
            origin: call.origin,
            result: json!({ "status": "ready" }),
            content: vec![],
        });
        self.browser()
            .write_json(&serde_json::to_vec(&result).unwrap())
            .await
            .unwrap();
    }

    async fn assert_no_browser_dispatch(&mut self) {
        assert!(
            timeout(NO_DISPATCH_WINDOW, self.browser().read_json())
                .await
                .is_err(),
            "a rejected call must never reach the browser"
        );
    }

    fn browser(&mut self) -> &mut AuthenticatedUnixStream {
        self.browser
            .as_mut()
            .expect("this session was started without a browser peer")
    }

    async fn finish(self) -> (std::process::ExitStatus, Vec<u8>, String) {
        let Self {
            child,
            stdout,
            browser,
            _directory,
        } = self;
        drop(browser);
        // Everything still buffered in the reader is part of stdout too.
        let buffered = stdout.buffer().to_vec();
        let (status, rest, stderr) = finish(child).await;
        let mut output = buffered;
        output.extend(rest);
        (status, output, stderr)
    }
}

async fn read_browser_bytes(stream: &mut AuthenticatedUnixStream) -> Vec<u8> {
    timeout(PROCESS_TIMEOUT, stream.read_json())
        .await
        .expect("browser frame timed out")
        .expect("browser frame must be readable")
        .expect("core closed the browser session")
}
