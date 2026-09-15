import { readFileSync } from "node:fs";

import {
  PROTOCOL_VERSION,
  type HelloAck,
  type ToolCall,
} from "@mcpatch/protocol";
import { describe, expect, it } from "vitest";

import {
  DEMO_CONTEXT_ID,
  DEMO_ORIGIN,
  DEMO_TOOL_NAME,
} from "../src/demo-capability.js";
import { startExtensionRuntime } from "../src/runtime.js";
import {
  FakeRuntime,
  FakeScheduler,
  parsePosted,
  TEST_OPTIONS,
} from "./support/native-session.js";

const demoSnapshot = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/protocol/fixtures/v1/valid/demo-capability-snapshot.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown;

describe("built-in demo capability", () => {
  it("publishes one closed read-only capability only after negotiation", () => {
    const { port } = setup();
    expect(port.posted).toHaveLength(1);

    port.emitMessage(helloAck());
    expect(parsePosted(port, 1)).toEqual(demoSnapshot);
  });

  it("returns a deterministic result only for the exact bound tool call", () => {
    const { port } = readySetup();
    port.emitMessage(toolCall());

    expect(parsePosted(port, 2)).toEqual({
      protocolVersion: 1,
      type: "tool_result",
      requestId: "request-1",
      contextId: DEMO_CONTEXT_ID,
      contextRevision: 1,
      origin: DEMO_ORIGIN,
      result: { status: "ready" },
    });
  });

  it.each([
    ["other.context", 1, DEMO_ORIGIN, DEMO_TOOL_NAME, {}, "CONTEXT_NOT_FOUND"],
    [DEMO_CONTEXT_ID, 2, DEMO_ORIGIN, DEMO_TOOL_NAME, {}, "CONTEXT_NOT_FOUND"],
    [
      DEMO_CONTEXT_ID,
      1,
      "https://other.invalid",
      DEMO_TOOL_NAME,
      {},
      "ORIGIN_MISMATCH",
    ],
    [DEMO_CONTEXT_ID, 1, DEMO_ORIGIN, "other.tool", {}, "TOOL_NOT_FOUND"],
    [
      DEMO_CONTEXT_ID,
      1,
      DEMO_ORIGIN,
      DEMO_TOOL_NAME,
      { unexpected: true },
      "INVALID_REQUEST",
    ],
  ] as const)(
    "rejects a mismatched request with %s",
    (contextId, contextRevision, origin, tool, args, code) => {
      const { port } = readySetup();
      const call = toolCall({ contextId, contextRevision, origin, tool, args });
      port.emitMessage(call);

      expect(parsePosted(port, 2)).toEqual({
        protocolVersion: 1,
        type: "tool_error",
        requestId: call.requestId,
        contextId,
        contextRevision,
        origin,
        code,
        message: "The demo capability rejected this request.",
        retryable: false,
      });
    },
  );

  it("fails the session closed for malformed tool traffic", () => {
    const { port } = readySetup();
    port.emitMessage({ ...toolCall(), unexpected: true });

    expect(port.disconnected).toBe(true);
    expect(port.posted).toHaveLength(2);
  });

  it("publishes a fresh revision after reconnect and closes on explicit stop", () => {
    const { runtime, scheduler, supervisor, port: first } = readySetup();
    first.emitDisconnect();
    scheduler.advanceBy(10);
    const second = runtime.latestPort;
    expect(second.posted).toHaveLength(1);

    second.emitMessage(helloAck({ connectionId: "connection-2" }));
    expect(parsePosted(second, 1)).toMatchObject({
      type: "capability_snapshot",
      contextId: DEMO_CONTEXT_ID,
      contextRevision: 2,
      origin: DEMO_ORIGIN,
    });

    supervisor.stop();
    expect(parsePosted(second, 2)).toEqual({
      protocolVersion: 1,
      type: "context_closed",
      contextId: DEMO_CONTEXT_ID,
      contextRevision: 2,
      reason: "disconnected",
    });
    expect(second.disconnected).toBe(true);
  });
});

function setup() {
  const runtime = new FakeRuntime();
  const scheduler = new FakeScheduler();
  const supervisor = startExtensionRuntime(runtime, {
    ...TEST_OPTIONS,
    scheduler,
  });
  return { runtime, scheduler, supervisor, port: runtime.latestPort };
}

function readySetup() {
  const state = setup();
  state.port.emitMessage(helloAck());
  return state;
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

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_call",
    requestId: "request-1",
    contextId: DEMO_CONTEXT_ID,
    contextRevision: 1,
    origin: DEMO_ORIGIN,
    tool: DEMO_TOOL_NAME,
    args: {},
    ...overrides,
  };
}
