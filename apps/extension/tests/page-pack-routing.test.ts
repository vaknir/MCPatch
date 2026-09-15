import {
  FLIGHTS_CURRENT_SEARCH,
  GOOGLE_FLIGHTS_FINGERPRINT,
  GOOGLE_FLIGHTS_ORIGIN,
  GOOGLE_FLIGHTS_SEARCH_PATH,
  googleFlightsPack,
} from "@mcpatch/google-flights-pack";
import type { JsonObject, PackExecutionContext } from "@mcpatch/sdk/runtime";
import { PROTOCOL_VERSION, type ToolCall } from "@mcpatch/protocol";
import { describe, expect, it, vi } from "vitest";

import type {
  NativeRuntimeTool,
  PageRuntimeTool,
} from "../src/compiled-pack-runtime.js";
import { flushPromises, packRuntime } from "./support/compiled-pack.js";

const CONTEXT_ID = "page.7";
const URL = `${GOOGLE_FLIGHTS_ORIGIN}${GOOGLE_FLIGHTS_SEARCH_PATH}`;
const CURRENT_RESULT = Object.freeze({
  fingerprint: GOOGLE_FLIGHTS_FINGERPRINT,
  path: "search" as const,
  tripType: "round_trip" as const,
  cabinClass: "economy" as const,
  passengers: "1 passenger",
  origin: "Alder Bay",
  destination: "Cedar Point",
  departure: "Tue, Oct 20",
  return: "Tue, Oct 27",
});

describe("page-backed compiled-pack routing", () => {
  it("publishes and executes only pack tools reported by the authorized page", async () => {
    const execute = vi.fn(() => CURRENT_RESULT);
    const { runtime, sent } = packRuntime([googleFlightsPack]);

    expect(
      runtime.activateContext({
        contextId: CONTEXT_ID,
        url: URL,
        native: [],
        page: [pageTool(FLIGHTS_CURRENT_SEARCH, execute)],
      }),
    ).toEqual({ ok: true, published: true, contextRevision: 1 });
    expect(sent[0]).toMatchObject({
      type: "capability_snapshot",
      capabilities: [
        {
          name: FLIGHTS_CURRENT_SEARCH,
          source: "pack",
          origin: GOOGLE_FLIGHTS_ORIGIN,
          risk: "read",
          permissions: ["READ"],
        },
      ],
    });

    runtime.handle(call());
    await flushPromises();

    expect(execute).toHaveBeenCalledOnce();
    expect(sent[1]).toMatchObject({
      type: "tool_result",
      result: CURRENT_RESULT,
    });
  });

  it("does not expose a page-backed pack when the page reports no tools", () => {
    const { runtime, sent } = packRuntime([googleFlightsPack]);

    expect(
      runtime.activateContext({
        contextId: CONTEXT_ID,
        url: URL,
        native: [],
        page: [],
      }),
    ).toEqual({ ok: true, published: false, contextRevision: 1 });
    expect(sent).toEqual([]);
  });

  it("rejects undeclared, duplicate, and nonmatching page pack routes", () => {
    for (const page of [
      [pageTool("flights.book", () => ({}))],
      [
        pageTool(FLIGHTS_CURRENT_SEARCH, () => CURRENT_RESULT),
        pageTool(FLIGHTS_CURRENT_SEARCH, () => CURRENT_RESULT),
      ],
    ]) {
      const { runtime, sent } = packRuntime([googleFlightsPack]);
      expect(
        runtime.activateContext({
          contextId: CONTEXT_ID,
          url: URL,
          native: [],
          page,
        }),
      ).toEqual({ ok: false, code: "RESOLUTION_REJECTED" });
      expect(sent).toEqual([]);
    }

    const outside = packRuntime([googleFlightsPack]);
    expect(
      outside.runtime.activateContext({
        contextId: CONTEXT_ID,
        url: `${GOOGLE_FLIGHTS_ORIGIN}/maps`,
        native: [],
        page: [pageTool(FLIGHTS_CURRENT_SEARCH, () => CURRENT_RESULT)],
      }),
    ).toEqual({ ok: false, code: "RESOLUTION_REJECTED" });
    expect(outside.sent).toEqual([]);
  });

  it("keeps native WebMCP precedence over a colliding page-pack route", async () => {
    const pageExecute = vi.fn(() => ({ ...CURRENT_RESULT, origin: "Page" }));
    const nativeExecute = vi.fn(() => ({
      ...CURRENT_RESULT,
      origin: "Native",
    }));
    const tool = googleFlightsPack.manifest.tools.find(
      (candidate) => candidate.name === FLIGHTS_CURRENT_SEARCH,
    );
    if (tool === undefined) throw new Error("missing current-search tool");
    const native: NativeRuntimeTool = { tool, execute: nativeExecute };
    const { runtime, sent } = packRuntime([googleFlightsPack]);

    runtime.activateContext({
      contextId: CONTEXT_ID,
      url: URL,
      native: [native],
      page: [pageTool(FLIGHTS_CURRENT_SEARCH, pageExecute)],
    });
    expect(sent[0]).toMatchObject({
      capabilities: [{ name: FLIGHTS_CURRENT_SEARCH, source: "native_webmcp" }],
    });
    runtime.handle(call());
    await flushPromises();

    expect(nativeExecute).toHaveBeenCalledOnce();
    expect(pageExecute).not.toHaveBeenCalled();
    expect(sent[1]).toMatchObject({ result: { origin: "Native" } });
  });
});

function pageTool(
  name: string,
  execute: (context: PackExecutionContext, input: JsonObject) => unknown,
): PageRuntimeTool {
  return { name, execute: execute as PageRuntimeTool["execute"] };
}

function call(): ToolCall {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_call",
    requestId: "request-google-1",
    contextId: CONTEXT_ID,
    contextRevision: 1,
    origin: GOOGLE_FLIGHTS_ORIGIN,
    tool: FLIGHTS_CURRENT_SEARCH,
    args: {},
  };
}
