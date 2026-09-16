import {
  FLIGHTS_CURRENT_SEARCH,
  FLIGHTS_SEARCH,
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
import {
  LOCAL_ORIGIN,
  LOCAL_TOOL,
  LOCAL_URL,
  localBundle,
} from "./support/local-pack.js";

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

  it("routes the closed search action only after bridge approval", async () => {
    const execute = vi.fn(() => ({
      fingerprint: GOOGLE_FLIGHTS_FINGERPRINT,
      state: "accepted",
    }));
    const { runtime, sent } = packRuntime([googleFlightsPack]);
    runtime.activateContext({
      contextId: CONTEXT_ID,
      url: URL,
      native: [],
      page: [pageTool(FLIGHTS_SEARCH, execute)],
    });

    expect(sent[0]).toMatchObject({
      capabilities: [
        {
          name: FLIGHTS_SEARCH,
          risk: "action",
          permissions: ["ACTION"],
        },
      ],
    });
    runtime.handle({
      ...call(),
      requestId: "request-search-1",
      tool: FLIGHTS_SEARCH,
      args: {
        origin: "LHR",
        destination: "CDG",
        outboundDate: "2026-10-27",
        returnDate: "2026-11-03",
      },
    });
    await flushPromises();

    expect(execute).toHaveBeenCalledOnce();
    expect(sent[1]).toMatchObject({
      type: "tool_result",
      result: {
        fingerprint: GOOGLE_FLIGHTS_FINGERPRINT,
        state: "accepted",
      },
    });
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

  it("publishes a native tool beside a same-named pack tool without either hiding the other", async () => {
    const pageExecute = vi.fn(() => ({ ...CURRENT_RESULT, origin: "Page" }));
    const nativeExecute = vi.fn(() => ({
      ...CURRENT_RESULT,
      origin: "Native",
    }));
    const tool = googleFlightsPack.manifest.tools.find(
      (candidate) => candidate.name === FLIGHTS_CURRENT_SEARCH,
    );
    if (tool === undefined) throw new Error("missing current-search tool");
    // A page-declared tool reaches the runtime already namespaced, so the name
    // a reviewed pack publishes is not one a page can take.
    const nativeName = `native.www_google_com.${FLIGHTS_CURRENT_SEARCH}`;
    const native: NativeRuntimeTool = {
      tool: { ...tool, name: nativeName },
      execute: nativeExecute,
    };
    const { runtime, sent } = packRuntime([googleFlightsPack]);

    runtime.activateContext({
      contextId: CONTEXT_ID,
      url: URL,
      native: [native],
      page: [pageTool(FLIGHTS_CURRENT_SEARCH, pageExecute)],
    });
    expect(sent[0]).toMatchObject({
      capabilities: [
        { name: FLIGHTS_CURRENT_SEARCH, source: "pack" },
        { name: nativeName, source: "native_webmcp" },
      ],
    });

    runtime.handle(call());
    await flushPromises();
    expect(pageExecute).toHaveBeenCalledOnce();
    expect(nativeExecute).not.toHaveBeenCalled();
    expect(sent[1]).toMatchObject({ result: { origin: "Page" } });
  });

  it("publishes and routes a validated local declarative definition only through a page handler", async () => {
    const bundle = await localBundle();
    const execute = vi.fn(() => ({ text: "Visible item" }));
    const { runtime, sent } = packRuntime([]);

    await expect(runtime.replaceDeclarativeDefinitions([bundle])).resolves.toBe(
      true,
    );
    expect(
      runtime.activateContext({
        contextId: CONTEXT_ID,
        url: LOCAL_URL,
        native: [],
        page: [pageTool(LOCAL_TOOL, execute)],
      }),
    ).toEqual({ ok: true, published: true, contextRevision: 1 });
    expect(sent[0]).toMatchObject({
      type: "capability_snapshot",
      origin: LOCAL_ORIGIN,
      capabilities: [
        {
          name: LOCAL_TOOL,
          source: "pack",
          pack: {
            publisher: bundle.manifest.publisher,
            id: bundle.manifest.id,
            digest: bundle.manifest.digest,
          },
        },
      ],
    });

    await expect(runtime.replaceDeclarativeDefinitions([bundle])).resolves.toBe(
      true,
    );
    expect(sent).toHaveLength(1);

    runtime.handle({
      protocolVersion: PROTOCOL_VERSION,
      type: "tool_call",
      requestId: "request-local-1",
      contextId: CONTEXT_ID,
      contextRevision: 1,
      origin: LOCAL_ORIGIN,
      tool: LOCAL_TOOL,
      args: {},
    });
    await flushPromises();
    expect(execute).toHaveBeenCalledOnce();
    expect(sent[1]).toMatchObject({
      type: "tool_result",
      result: { text: "Visible item" },
    });
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
