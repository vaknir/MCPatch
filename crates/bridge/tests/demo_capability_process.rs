#![cfg(any(unix, windows))]

mod demo_process_support;

use mcpatch_bridge::protocol::Message;
use serde_json::{Value, json};
use tokio::time::timeout;

use demo_process_support::{
    BrowserAdapter, McpClient, RunningCore, TEST_TIMEOUT, TestDirectory, close_demo_context,
    complete_demo_call, demo_snapshot,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bundled_demo_runs_across_native_host_core_and_mcp_processes() {
    timeout(TEST_TIMEOUT * 8, run_scenario())
        .await
        .expect("demo process scenario exceeded its deterministic bound");
}

async fn run_scenario() {
    let fixture = TestDirectory::new();
    let first_core = RunningCore::start(&fixture).await;
    let mut browser = BrowserAdapter::connect(&fixture).await;
    let first_connection_id = browser.connection_id().to_owned();
    browser.send(demo_snapshot(1)).await;

    let mut mcp = McpClient::connect(&fixture).await;
    let tools = mcp.wait_for_tool_count(1).await;
    assert_demo_tool(&tools[0]);
    invoke_demo(&mut mcp, &mut browser).await;

    let pending_id = mcp.start_call().await;
    let pending = expect_tool_call(browser.receive().await);
    browser.send(close_demo_context(1)).await;
    let Message::Cancel(cancel) = browser.receive().await else {
        panic!("context closure must cancel the pending browser call");
    };
    assert_eq!(cancel.request_id, pending.request_id);
    assert_safe_tool_failure(&mcp.read_response(pending_id).await);
    assert!(mcp.wait_for_tool_count(0).await.is_empty());

    browser.send(demo_snapshot(2)).await;
    assert_eq!(mcp.wait_for_tool_count(1).await.len(), 1);
    let disconnected_id = mcp.start_call().await;
    expect_tool_call(browser.receive().await);
    browser.finish_clean().await;
    assert_safe_tool_failure(&mcp.read_response(disconnected_id).await);
    assert!(mcp.wait_for_tool_count(0).await.is_empty());

    first_core.stop().await;
    mcp.finish_after_core_close().await;

    let second_core = RunningCore::start(&fixture).await;
    let mut restarted_mcp = McpClient::connect(&fixture).await;
    assert!(restarted_mcp.list_tools().await.is_empty());
    let mut restarted_browser = BrowserAdapter::connect(&fixture).await;
    assert_ne!(restarted_browser.connection_id(), first_connection_id);
    assert!(restarted_mcp.list_tools().await.is_empty());
    restarted_browser.send(demo_snapshot(1)).await;
    assert_eq!(restarted_mcp.wait_for_tool_count(1).await.len(), 1);
    invoke_demo(&mut restarted_mcp, &mut restarted_browser).await;

    restarted_browser.send(close_demo_context(1)).await;
    assert!(restarted_mcp.wait_for_tool_count(0).await.is_empty());
    restarted_browser.finish_clean().await;
    restarted_mcp.finish_clean().await;
    second_core.stop().await;
}

async fn invoke_demo(mcp: &mut McpClient, browser: &mut BrowserAdapter) {
    let id = mcp.start_call().await;
    let call = expect_tool_call(browser.receive().await);
    assert_eq!(call.context_id, "mcpatch.demo");
    assert_eq!(call.origin, "https://demo.mcpatch.invalid");
    assert_eq!(call.tool, "mcpatch.demo.status");
    assert!(call.args.is_empty());
    browser.send(complete_demo_call(call)).await;

    let response = mcp.read_response(id).await;
    assert_eq!(
        response["result"]["structuredContent"],
        json!({"status": "ready"})
    );
    assert_eq!(response["result"]["isError"], false);
    assert!(!response.to_string().contains("browser."));
}

fn expect_tool_call(message: Message) -> mcpatch_bridge::protocol::ToolCall {
    let Message::ToolCall(call) = message else {
        panic!("browser must receive a tool call");
    };
    call
}

fn assert_demo_tool(tool: &Value) {
    assert_eq!(tool["name"], "mcpatch.demo.status");
    assert_eq!(tool["annotations"]["readOnlyHint"], true);
    assert_eq!(tool["inputSchema"]["maxProperties"], 0);
    assert_eq!(tool["outputSchema"]["required"], json!(["status"]));
}

fn assert_safe_tool_failure(response: &Value) {
    assert_eq!(response["result"]["isError"], true);
    let serialized = response.to_string();
    assert!(!serialized.contains("https://demo.mcpatch.invalid"));
    assert!(!serialized.contains("browser."));
    assert!(!serialized.contains("contextRevision"));
}
