import type { JsonObject, JsonValue } from "@mcpatch/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  encodeWorkerToPageMessage,
  PAGE_PROTOCOL_VERSION,
  parsePageToWorkerFrame,
  type PageBinding,
  type PageCapability,
  type PageToWorkerMessage,
} from "../src/page-channel.js";
import type { PageAdapter } from "../src/page-content-model.js";
import { PageContentRuntime } from "../src/page-content-runtime.js";
import { MCPATCH_PAGE_PORT_NAME } from "../src/page-context-model.js";
import { FakeScheduler } from "./support/native-session.js";
import {
  FakePageClientRuntime,
  FakePageLifecycle,
  type FakePagePort,
} from "./support/page-context.js";

const BINDING: PageBinding = Object.freeze({
  channelId: "channel.test",
  contextId: "page.7",
  contextRevision: 1,
  tabId: 7,
  documentId: "document-1",
  origin: "https://example.com",
});
const CAPABILITY: PageCapability = {
  source: "pack",
  name: "flights.current_search",
};

describe("page content runtime", () => {
  it("negotiates a fixed port and publishes a validated snapshot", async () => {
    const authorizePackTools = vi.fn();
    const adapter = createAdapter({ authorizePackTools });
    const state = setup(adapter);
    state.content.wake();
    const port = state.runtime.latestPort;

    expect(port.name).toBe(MCPATCH_PAGE_PORT_NAME);
    expect(posted(port, 0)).toMatchObject({
      type: "page_hello",
      supportedPageProtocolVersions: [PAGE_PROTOCOL_VERSION],
    });

    acknowledge(port);
    await settle();

    expect(authorizePackTools).toHaveBeenCalledWith([CAPABILITY.name]);

    expect(posted(port, 1)).toEqual({
      pageProtocolVersion: PAGE_PROTOCOL_VERSION,
      type: "page_capability_snapshot",
      ...BINDING,
      snapshotRevision: 1,
      capabilities: [CAPABILITY],
    });
  });

  it("bounds handshake time and rejects a worker-claimed crossed origin", () => {
    const silent = setup(createAdapter());
    silent.content.wake();
    silent.scheduler.advanceBy(49);
    expect(silent.runtime.latestPort.disconnected).toBe(false);
    silent.scheduler.advanceBy(1);
    expect(silent.runtime.latestPort.disconnected).toBe(true);

    const crossed = setup(createAdapter());
    crossed.content.wake();
    const port = crossed.runtime.latestPort;
    port.emitMessage(
      encodeWorkerToPageMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_hello_ack",
        selectedPageProtocolVersion: PAGE_PROTOCOL_VERSION,
        implementation: { name: "mcpatch-extension", version: "0.1.0" },
        authorizedPackTools: [CAPABILITY.name],
        ...BINDING,
        origin: "https://attacker.example",
      }),
    );
    expect(port.disconnected).toBe(true);
  });

  it("executes only an announced tool and returns a bounded result", async () => {
    const execute = vi.fn(
      async (_tool: string, args: JsonObject): Promise<JsonValue> => ({
        received: args,
      }),
    );
    const state = setup(createAdapter({ execute }));
    const port = ready(state);
    await settle();

    port.emitMessage(call("request-1", { cabin: "economy" }));
    await settle();

    expect(execute).toHaveBeenCalledWith(
      CAPABILITY.name,
      { cabin: "economy" },
      expect.any(AbortSignal),
    );
    expect(posted(port, 2)).toMatchObject({
      type: "page_tool_result",
      requestId: "request-1",
      tool: CAPABILITY.name,
      result: { received: { cabin: "economy" } },
    });

    port.emitMessage(call("request-2", {}, "flights.unknown"));
    expect(posted(port, 3)).toMatchObject({
      type: "page_tool_error",
      requestId: "request-2",
      code: "TOOL_UNAVAILABLE",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects unsafe adapter output without invoking accessors", async () => {
    let accessed = false;
    const result = {};
    Object.defineProperty(result, "secret", {
      enumerable: true,
      get() {
        accessed = true;
        return "must-not-run";
      },
    });
    const state = setup(
      createAdapter({
        async execute() {
          return result as JsonValue;
        },
      }),
    );
    const port = ready(state);
    await settle();

    port.emitMessage(call("request-unsafe", {}));
    await settle();

    expect(accessed).toBe(false);
    expect(posted(port, 2)).toMatchObject({
      type: "page_tool_error",
      requestId: "request-unsafe",
      code: "RESULT_INVALID",
    });
  });

  it("cancels exact calls and closes on crossed bindings", async () => {
    let executionSignal: AbortSignal | undefined;
    const state = setup(
      createAdapter({
        execute(_tool, _args, signal) {
          executionSignal = signal;
          return new Promise<JsonValue>(() => undefined);
        },
      }),
    );
    const port = ready(state);
    await settle();
    port.emitMessage(call("request-1", {}));
    await settle();

    port.emitMessage(
      encodeWorkerToPageMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_cancel",
        ...BINDING,
        requestId: "request-1",
        tool: CAPABILITY.name,
      }),
    );
    expect(executionSignal?.aborted).toBe(true);

    port.emitMessage(
      call("request-crossed", {}, CAPABILITY.name, {
        documentId: "another-document",
      }),
    );
    expect(port.disconnected).toBe(true);
    state.scheduler.advanceBy(10);
    expect(state.runtime.ports).toHaveLength(2);
  });

  it("refreshes monotonically and stops cleanly on pagehide", async () => {
    let listener: (() => void) | undefined;
    const capabilities = [CAPABILITY];
    const unsubscribe = vi.fn();
    const adapter = createAdapter({
      capabilities: async () => capabilities,
      subscribe(next) {
        listener = next;
        return unsubscribe;
      },
    });
    const lifecycle = new FakePageLifecycle();
    const state = setup(adapter, lifecycle);
    const port = ready(state, [CAPABILITY.name, "flights.results"]);
    await settle();

    capabilities.push({ source: "pack", name: "flights.results" });
    listener?.();
    await settle();
    expect(posted(port, 2)).toMatchObject({
      type: "page_capability_snapshot",
      snapshotRevision: 2,
      capabilities,
    });

    lifecycle.pagehide();
    expect(posted(port, 3)).toMatchObject({
      type: "page_context_closed",
      reason: "document_unloading",
    });
    expect(port.disconnected).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    state.scheduler.advanceBy(1_000);
    expect(state.runtime.ports).toHaveLength(1);
  });

  it("fails closed when discovery throws synchronously or sends invalid data", async () => {
    const thrown = setup(
      createAdapter({
        capabilities() {
          throw new Error("discovery failed");
        },
      }),
    );
    const thrownPort = ready(thrown);
    await settle();
    expect(thrownPort.disconnected).toBe(true);

    const invalid = setup(
      createAdapter({
        async capabilities() {
          return [{ source: "pack", name: "invalid name" } as PageCapability];
        },
      }),
    );
    const invalidPort = ready(invalid);
    await settle();
    expect(invalidPort.disconnected).toBe(true);

    const unauthorized = setup(
      createAdapter({
        async capabilities() {
          return [{ source: "pack", name: "flights.results" }];
        },
      }),
    );
    const unauthorizedPort = ready(unauthorized);
    await settle();
    expect(unauthorizedPort.disconnected).toBe(true);
  });
});

function setup(adapter: PageAdapter, lifecycle?: FakePageLifecycle) {
  const runtime = new FakePageClientRuntime();
  const scheduler = new FakeScheduler();
  const content = new PageContentRuntime(runtime, adapter, {
    expectedOrigin: BINDING.origin,
    handshakeTimeoutMs: 50,
    ...(lifecycle === undefined ? {} : { lifecycle }),
    retryDelaysMs: [10],
    scheduler,
  });
  return { content, runtime, scheduler };
}

function ready(
  state: ReturnType<typeof setup>,
  authorizedPackTools: readonly string[] = [CAPABILITY.name],
): FakePagePort {
  state.content.wake();
  const port = state.runtime.latestPort;
  acknowledge(port, authorizedPackTools);
  return port;
}

function acknowledge(
  port: FakePagePort,
  authorizedPackTools: readonly string[] = [CAPABILITY.name],
): void {
  port.emitMessage(
    encodeWorkerToPageMessage({
      pageProtocolVersion: PAGE_PROTOCOL_VERSION,
      type: "page_hello_ack",
      selectedPageProtocolVersion: PAGE_PROTOCOL_VERSION,
      implementation: { name: "mcpatch-extension", version: "0.1.0" },
      authorizedPackTools,
      ...BINDING,
    }),
  );
}

function call(
  requestId: string,
  args: JsonObject,
  tool = CAPABILITY.name,
  bindingOverrides: Partial<PageBinding> = {},
): string {
  return encodeWorkerToPageMessage({
    pageProtocolVersion: PAGE_PROTOCOL_VERSION,
    type: "page_tool_call",
    ...BINDING,
    ...bindingOverrides,
    requestId,
    tool,
    args,
  });
}

function posted(port: FakePagePort, index: number): PageToWorkerMessage {
  return parsePageToWorkerFrame(port.posted[index]);
}

function createAdapter(overrides: Partial<PageAdapter> = {}): PageAdapter {
  return {
    async capabilities() {
      return [CAPABILITY];
    },
    async execute() {
      return {};
    },
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
