import {
  PROTOCOL_VERSION,
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
  FakeRuntime,
  FakeScheduler,
  parsePosted,
  TEST_OPTIONS,
} from "./support/native-session.js";

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

function toolCall(): ToolCall {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_call",
    requestId: "request-1",
    contextId: "tab-1",
    contextRevision: 1,
    origin: "https://example.com",
    tool: "demo.read",
    args: {},
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

function connectionError(fatal: boolean): ConnectionError {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "connection_error",
    code: "INVALID_STATE",
    message: "The peer closed the session.",
    fatal,
  };
}
