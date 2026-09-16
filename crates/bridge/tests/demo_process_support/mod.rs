mod browser;
mod mcp;
mod runtime;

use mcpatch_bridge::protocol::{
    ContextClosed, ContextClosedReason, Message, PROTOCOL_VERSION, ToolCall, ToolResult,
    parse_message,
};
use serde_json::json;

pub(crate) use browser::BrowserAdapter;
pub(crate) use mcp::McpClient;
pub(crate) use runtime::{RunningCore, TestDirectory};

pub(crate) const TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

pub(crate) fn demo_snapshot(revision: u64) -> Message {
    let Message::CapabilitySnapshot(mut snapshot) = parse_message(include_bytes!(
        "../../../../packages/protocol/fixtures/v2/valid/demo-capability-snapshot.json"
    ))
    .unwrap() else {
        panic!("demo fixture must contain a capability snapshot");
    };
    snapshot.context_revision = revision;
    Message::CapabilitySnapshot(snapshot)
}

pub(crate) fn close_demo_context(revision: u64) -> Message {
    Message::ContextClosed(ContextClosed {
        protocol_version: PROTOCOL_VERSION,
        context_id: "mcpatch.demo".to_owned(),
        context_revision: revision,
        reason: ContextClosedReason::Disconnected,
    })
}

pub(crate) fn complete_demo_call(call: ToolCall) -> Message {
    Message::ToolResult(ToolResult {
        protocol_version: PROTOCOL_VERSION,
        request_id: call.request_id,
        context_id: call.context_id,
        context_revision: call.context_revision,
        origin: call.origin,
        result: json!({"status": "ready"}),
        content: vec![],
    })
}
