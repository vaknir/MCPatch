import { readFileSync } from "node:fs";

import {
  DEMO_CONTEXT_ID,
  DEMO_ORIGIN,
  DEMO_TOOL_NAME,
} from "@mcpatch/example-packs";
import { describe, expect, it } from "vitest";

import { parsePosted } from "./support/native-session.js";
import {
  flushPromises,
  helloAck,
  packRuntime,
  readyExtension,
  readyPackRuntime,
  setupExtension,
  toolCall,
} from "./support/compiled-pack.js";

const demoSnapshot = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/protocol/fixtures/v2/valid/demo-capability-snapshot.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown;

describe("compiled pack extension integration", () => {
  it("publishes the reviewed pack only after negotiation and exact matching", () => {
    const { port } = setupExtension();
    expect(port.posted).toHaveLength(1);

    port.emitMessage(helloAck());

    expect(parsePosted(port, 1)).toEqual(demoSnapshot);
  });

  it("routes the existing demo result through the compiled handler", async () => {
    const { port } = readyExtension();
    port.emitMessage(toolCall());
    await flushPromises();

    expect(parsePosted(port, 2)).toEqual({
      protocolVersion: 2,
      type: "tool_result",
      requestId: "request-1",
      contextId: DEMO_CONTEXT_ID,
      contextRevision: 1,
      origin: DEMO_ORIGIN,
      result: { status: "ready" },
    });
  });

  it("does not publish when the exact pack path does not match", () => {
    const { runtime, sent } = packRuntime();

    const result = runtime.activateContext({
      contextId: DEMO_CONTEXT_ID,
      url: `${DEMO_ORIGIN}/other`,
      native: [],
    });

    expect(result).toEqual({ ok: true, published: false, contextRevision: 1 });
    expect(sent).toEqual([]);
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
    "rejects an unbound request with %s",
    async (contextId, contextRevision, origin, tool, args, code) => {
      const { runtime, sent } = readyPackRuntime();
      const call = toolCall({ contextId, contextRevision, origin, tool, args });

      expect(runtime.handle(call)).toBe(true);
      await flushPromises();

      expect(sent[1]).toEqual({
        protocolVersion: 2,
        type: "tool_error",
        requestId: call.requestId,
        contextId,
        contextRevision,
        origin,
        code,
        message: "The compiled capability rejected this request.",
        retryable: false,
      });
    },
  );

  it("publishes a fresh revision after reconnect and closes on explicit stop", () => {
    const { runtime, scheduler, supervisor, port: first } = readyExtension();
    first.emitDisconnect();
    scheduler.advanceBy(10);
    const second = runtime.latestPort;
    second.emitMessage(helloAck({ connectionId: "connection-2" }));

    expect(parsePosted(second, 1)).toMatchObject({
      type: "capability_snapshot",
      contextId: DEMO_CONTEXT_ID,
      contextRevision: 2,
      origin: DEMO_ORIGIN,
    });

    supervisor.stop();
    expect(parsePosted(second, 2)).toEqual({
      protocolVersion: 2,
      type: "context_closed",
      contextId: DEMO_CONTEXT_ID,
      contextRevision: 2,
      reason: "disconnected",
    });
  });
});
