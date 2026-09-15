import { DEMO_CONTEXT_ID, demoPack } from "@mcpatch/example-packs";
import {
  PROTOCOL_VERSION,
  type ApprovalRequired,
  type ConnectionError,
  type ContextClosed,
  type HelloAck,
  type Message,
  type ToolCall,
  type ToolResult,
} from "@mcpatch/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  MCPATCH_NATIVE_HOST_NAME,
  NativeSessionSupervisor,
} from "../src/native-session.js";
import { startExtensionRuntime } from "../src/runtime.js";
import {
  encodePageToWorkerMessage,
  PAGE_PROTOCOL_VERSION,
  type PageBinding,
  parseWorkerToPageFrame,
} from "../src/page-channel.js";
import { MCPATCH_PAGE_PORT_NAME } from "../src/page-context-model.js";
import {
  FakeRuntime,
  FakeScheduler,
  parsePosted,
  TEST_OPTIONS,
} from "./support/native-session.js";
import { FakePagePort } from "./support/page-context.js";
import {
  SITE_ORIGIN,
  SITE_TOOL,
  runtimeOptions,
  sitePack,
} from "./support/site-pack.js";

describe("native session supervisor", () => {
  it("registers lifecycle listeners and opens only the fixed native host", () => {
    const runtime = new FakeRuntime();
    const scheduler = new FakeScheduler();
    const supervisor = startExtensionRuntime(runtime, {
      ...TEST_OPTIONS,
      scheduler,
    });

    expect(runtime.onInstalled.listenerCount).toBe(1);
    expect(runtime.onStartup.listenerCount).toBe(1);
    expect(runtime.onConnect.listenerCount).toBe(1);
    expect(runtime.applications).toEqual([MCPATCH_NATIVE_HOST_NAME]);
    expect(supervisor.state).toEqual({ phase: "negotiating" });
    expect(parsePosted(runtime.latestPort, 0)).toEqual({
      protocolVersion: 1,
      type: "hello",
      role: "extension",
      supportedProtocolVersions: [1],
      implementation: {
        name: "mcpatch-extension",
        version: "0.1.0",
      },
    });

    runtime.onInstalled.emit({ reason: "install" });
    runtime.onStartup.emit();
    expect(runtime.ports).toHaveLength(1);
  });

  it("rejects downgraded acknowledgements and retries without duplicate ports", () => {
    const runtime = new FakeRuntime();
    const scheduler = new FakeScheduler();
    const supervisor = new NativeSessionSupervisor(runtime, {
      ...TEST_OPTIONS,
      scheduler,
      supportedProtocolVersions: [1, 2],
    });
    supervisor.wake();
    const first = runtime.latestPort;

    first.emitMessage(
      helloAck({
        supportedProtocolVersions: [1, 2],
        selectedProtocolVersion: 1,
      }),
    );
    expect(first.disconnected).toBe(true);
    expect(supervisor.state).toEqual({ phase: "waiting_retry" });

    supervisor.wake();
    scheduler.advanceBy(9);
    expect(runtime.ports).toHaveLength(1);
    scheduler.advanceBy(1);
    expect(runtime.ports).toHaveLength(2);
    expect(parsePosted(runtime.latestPort, 0).type).toBe("hello");

    runtime.latestPort.emitMessage(
      helloAck({
        connectionId: "connection-2",
        supportedProtocolVersions: [1],
        selectedProtocolVersion: 1,
      }),
    );
    expect(supervisor.state).toEqual({
      phase: "ready",
      connectionId: "connection-2",
      protocolVersion: 1,
    });
  });

  it("sends heartbeats and never replays application messages after reconnect", () => {
    const runtime = new FakeRuntime();
    const scheduler = new FakeScheduler();
    const supervisor = new NativeSessionSupervisor(runtime, {
      ...TEST_OPTIONS,
      scheduler,
    });
    supervisor.wake();
    const first = runtime.latestPort;
    first.emitMessage(helloAck());

    scheduler.advanceBy(100);
    expect(parsePosted(first, 1)).toEqual({
      protocolVersion: 1,
      type: "heartbeat",
      heartbeatId: "heartbeat.1.1",
      sentAt: "2026-09-15T00:00:00.100Z",
    });
    const closed = contextClosed("tab-1");
    expect(supervisor.send(closed)).toBe(true);
    expect(parsePosted(first, 2)).toEqual(closed);

    first.emitDisconnect();
    expect(supervisor.state).toEqual({ phase: "waiting_retry" });
    expect(supervisor.send(contextClosed("tab-2"))).toBe(false);
    scheduler.advanceBy(10);

    const second = runtime.latestPort;
    expect(second).not.toBe(first);
    expect(second.posted).toHaveLength(1);
    expect(parsePosted(second, 0).type).toBe("hello");
    second.emitMessage(helloAck({ connectionId: "connection-2" }));
    expect(second.posted).toHaveLength(1);

    second.emitDisconnect();
    scheduler.advanceBy(10);
    expect(runtime.ports).toHaveLength(3);
  });

  it("closes malformed, unadvertised, wrong-direction, and fatal traffic", () => {
    const malformed = setup();
    malformed.runtime.latestPort.emitMessage({ type: "hello_ack" });
    expect(malformed.runtime.latestPort.disconnected).toBe(true);

    const unadvertised = setup({ supportedProtocolVersions: [1, 2] });
    unadvertised.runtime.latestPort.emitMessage(
      helloAck({
        supportedProtocolVersions: [1],
        selectedProtocolVersion: 2,
      }),
    );
    expect(unadvertised.runtime.latestPort.disconnected).toBe(true);

    const reversed = setup();
    reversed.runtime.latestPort.emitMessage(helloAck());
    reversed.runtime.latestPort.emitMessage(toolResult());
    expect(reversed.runtime.latestPort.disconnected).toBe(true);

    const fatal = setup();
    fatal.runtime.latestPort.emitMessage(helloAck());
    fatal.runtime.latestPort.emitMessage(connectionError(true));
    expect(fatal.runtime.latestPort.disconnected).toBe(true);
  });

  it("bounds handshake and reconnect timers below worker idle expiry", () => {
    const { runtime, scheduler, supervisor } = setup();
    scheduler.advanceBy(49);
    expect(supervisor.state).toEqual({ phase: "negotiating" });
    scheduler.advanceBy(1);
    expect(runtime.latestPort.disconnected).toBe(true);
    expect(supervisor.state).toEqual({ phase: "waiting_retry" });
    scheduler.advanceBy(10);
    expect(runtime.ports).toHaveLength(2);

    expect(
      () =>
        new NativeSessionSupervisor(new FakeRuntime(), {
          heartbeatIntervalMs: 30_000,
        }),
    ).toThrow(TypeError);
  });

  it("delivers typed bridge calls only to an installed handler", () => {
    const onMessage = vi.fn<(message: Message) => void>();
    const handled = setup({ onMessage });
    handled.runtime.latestPort.emitMessage(helloAck());
    const call = toolCall();
    handled.runtime.latestPort.emitMessage(call);
    expect(onMessage).toHaveBeenCalledWith(call);
    expect(handled.supervisor.state.phase).toBe("ready");

    const unhandled = setup();
    unhandled.runtime.latestPort.emitMessage(helloAck());
    unhandled.runtime.latestPort.emitMessage(call);
    expect(unhandled.runtime.latestPort.disconnected).toBe(true);
  });

  it("denies approvals until a trusted extension UI is installed", () => {
    const runtime = new FakeRuntime();
    const scheduler = new FakeScheduler();
    startExtensionRuntime(runtime, { ...TEST_OPTIONS, scheduler });
    const port = runtime.latestPort;
    port.emitMessage(helloAck());

    port.emitMessage(approvalRequired());

    expect(parsePosted(port, 2)).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      type: "approval_result",
      approvalId: "approval.0123456789abcdef0123456789abcdef",
      requestId: "request-approval",
      decision: "denied",
    });
    expect(port.disconnected).toBe(false);
  });

  it("stops cleanly and ignores stale port events", () => {
    const { runtime, scheduler, supervisor } = setup();
    const first = runtime.latestPort;
    supervisor.stop();
    expect(first.disconnected).toBe(true);
    expect(supervisor.state).toEqual({ phase: "stopped" });

    first.emitDisconnect();
    first.emitMessage(helloAck());
    scheduler.advanceBy(1_000);
    expect(runtime.ports).toHaveLength(1);
  });

  it("notifies application state when a ready connection is lost", () => {
    const onDisconnected = vi.fn();
    const { runtime } = setup({ onDisconnected });
    runtime.latestPort.emitMessage(helloAck());

    runtime.latestPort.emitDisconnect();

    expect(onDisconnected).toHaveBeenCalledOnce();
  });

  it("admits page ownership only while the bridge session is ready", () => {
    const runtime = new FakeRuntime();
    const scheduler = new FakeScheduler();
    startExtensionRuntime(runtime, {
      ...TEST_OPTIONS,
      scheduler,
      pageAuthority: {
        authorize() {
          return { packTools: new Set(["flights.current_search"]) };
        },
      },
      pageRandomId: () => "channel.test",
      pageScheduler: scheduler,
    });

    const premature = new FakePagePort(MCPATCH_PAGE_PORT_NAME);
    runtime.onConnect.emit(premature);
    expect(premature.disconnected).toBe(true);

    runtime.latestPort.emitMessage(helloAck());
    const accepted = new FakePagePort(MCPATCH_PAGE_PORT_NAME);
    runtime.onConnect.emit(accepted);
    accepted.emitMessage(
      encodePageToWorkerMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_hello",
        supportedPageProtocolVersions: [PAGE_PROTOCOL_VERSION],
        implementation: { name: "test-content", version: "0.1.0" },
      }),
    );
    expect(parseWorkerToPageFrame(accepted.posted[0]).type).toBe(
      "page_hello_ack",
    );

    runtime.latestPort.emitDisconnect();
    expect(accepted.disconnected).toBe(true);
  });

  it("projects a page-native capability through the bridge and revokes it", async () => {
    const runtime = new FakeRuntime();
    const scheduler = new FakeScheduler();
    startExtensionRuntime(runtime, {
      ...TEST_OPTIONS,
      scheduler,
      compiledPacks: [demoPack, sitePack],
      compiledPackRuntimeOptions: runtimeOptions(),
      pageAuthority: {
        authorize(identity) {
          return identity.origin === SITE_ORIGIN
            ? { packTools: new Set([SITE_TOOL]) }
            : undefined;
        },
      },
      pageRandomId: () => "channel.native",
      pageScheduler: scheduler,
    });
    const bridge = runtime.latestPort;
    bridge.emitMessage(helloAck());

    const page = new FakePagePort(MCPATCH_PAGE_PORT_NAME, {
      id: runtime.id,
      documentId: "document-native",
      documentLifecycle: "active",
      frameId: 0,
      origin: SITE_ORIGIN,
      tab: { id: 9 },
      url: `${SITE_ORIGIN}/app/search`,
    });
    runtime.onConnect.emit(page);
    page.emitMessage(
      encodePageToWorkerMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_hello",
        supportedPageProtocolVersions: [PAGE_PROTOCOL_VERSION],
        implementation: { name: "test-content", version: "0.1.0" },
      }),
    );
    const acknowledgement = parseWorkerToPageFrame(page.posted[0]);
    if (acknowledgement.type !== "page_hello_ack") {
      throw new Error("expected page acknowledgement");
    }
    const binding: PageBinding = {
      channelId: acknowledgement.channelId,
      contextId: acknowledgement.contextId,
      contextRevision: acknowledgement.contextRevision,
      tabId: acknowledgement.tabId,
      documentId: acknowledgement.documentId,
      origin: acknowledgement.origin,
    };
    page.emitMessage(
      encodePageToWorkerMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_capability_snapshot",
        ...binding,
        snapshotRevision: 1,
        capabilities: [
          {
            source: "native_webmcp",
            name: SITE_TOOL,
            description: "Read current fixture state.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              maxProperties: 0,
              properties: {},
            },
            annotations: {
              readOnlyHint: true,
              consequentialHint: false,
              untrustedContentHint: true,
            },
          },
        ],
      }),
    );

    expect(parsePosted(bridge, 2)).toMatchObject({
      type: "capability_snapshot",
      contextId: "page.9",
      contextRevision: 1,
      origin: SITE_ORIGIN,
      capabilities: [{ name: SITE_TOOL, source: "native_webmcp" }],
    });

    bridge.emitMessage(
      toolCall({
        contextId: "page.9",
        origin: SITE_ORIGIN,
        tool: SITE_TOOL,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const call = parseWorkerToPageFrame(page.posted[1]);
    expect(call).toMatchObject({ type: "page_tool_call", tool: SITE_TOOL });
    if (call.type !== "page_tool_call") throw new Error("expected page call");
    page.emitMessage(
      encodePageToWorkerMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_tool_result",
        ...binding,
        requestId: call.requestId,
        tool: call.tool,
        result: { status: "page" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(parsePosted(bridge, 3)).toMatchObject({
      type: "tool_result",
      contextId: "page.9",
      result: { status: "page" },
    });

    page.emitDisconnect();
    expect(parsePosted(bridge, 4)).toMatchObject({
      type: "context_closed",
      contextId: "page.9",
      reason: "navigation",
    });
    expect(parsePosted(bridge, 1)).toMatchObject({
      type: "capability_snapshot",
      contextId: DEMO_CONTEXT_ID,
    });
  });

  it("fails closed around application lifecycle hook errors", () => {
    const failedReady = setup({
      onReady() {
        throw new Error("ready hook failed");
      },
    });
    failedReady.runtime.latestPort.emitMessage(helloAck());
    expect(failedReady.runtime.latestPort.disconnected).toBe(true);
    expect(failedReady.supervisor.state).toEqual({ phase: "waiting_retry" });

    const failedStop = setup({
      onStopping() {
        throw new Error("stopping hook failed");
      },
    });
    failedStop.runtime.latestPort.emitMessage(helloAck());
    failedStop.supervisor.stop();
    expect(failedStop.runtime.latestPort.disconnected).toBe(true);
    expect(failedStop.supervisor.state).toEqual({ phase: "stopped" });
  });
});

function setup(
  options: Partial<
    ConstructorParameters<typeof NativeSessionSupervisor>[1]
  > = {},
) {
  const runtime = new FakeRuntime();
  const scheduler = new FakeScheduler();
  const supervisor = new NativeSessionSupervisor(runtime, {
    ...TEST_OPTIONS,
    scheduler,
    ...options,
  });
  supervisor.wake();
  return { runtime, scheduler, supervisor };
}

function helloAck(overrides: Partial<HelloAck> = {}): HelloAck {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "hello_ack",
    supportedProtocolVersions: [PROTOCOL_VERSION],
    selectedProtocolVersion: PROTOCOL_VERSION,
    connectionId: "connection-1",
    implementation: { name: "mcpatch-bridge", version: "0.1.0" },
    ...overrides,
  };
}

function contextClosed(contextId: string): ContextClosed {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "context_closed",
    contextId,
    contextRevision: 1,
    reason: "tab_closed",
  };
}

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_call",
    requestId: "request-1",
    contextId: "tab-1",
    contextRevision: 1,
    origin: "https://example.com",
    tool: "demo.read",
    args: {},
    ...overrides,
  };
}

function toolResult(): ToolResult {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_result",
    requestId: "request-1",
    contextId: "tab-1",
    contextRevision: 1,
    origin: "https://example.com",
    result: {},
  };
}

function approvalRequired(): ApprovalRequired {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "approval_required",
    approvalId: "approval.0123456789abcdef0123456789abcdef",
    requestId: "request-approval",
    contextId: "tab-1",
    contextRevision: 1,
    origin: "https://example.com",
    tool: "demo.action",
    argsHash: "a".repeat(64),
    expiresAt: "2026-09-15T00:01:00Z",
  };
}

function connectionError(fatal: boolean): ConnectionError {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "connection_error",
    code: "INVALID_STATE",
    message: "The peer closed the session.",
    fatal,
  };
}
