import { describe, expect, it } from "vitest";

import {
  createNativeWebMcpAdapter,
  NativeWebMcpAdapter,
} from "../src/native-webmcp-adapter.js";
import type {
  DraftModelContext,
  DraftRegisteredTool,
} from "../src/native-webmcp-model.js";
import { PageAdapterExecutionError } from "../src/page-content-model.js";

const ORIGIN = "https://example.com";
const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  consequentialHint: false,
  untrustedContentHint: true,
});

describe("native WebMCP adapter", () => {
  it("detects only the bounded draft surface and requires a canonical HTTPS origin", () => {
    expect(createNativeWebMcpAdapter({}, ORIGIN)).toBeUndefined();
    expect(
      createNativeWebMcpAdapter({ modelContext: { getTools() {} } }, ORIGIN),
    ).toBeUndefined();

    const context = new FakeModelContext([]);
    expect(
      createNativeWebMcpAdapter({ modelContext: context }, ORIGIN),
    ).toBeDefined();
    expect(
      () => new NativeWebMcpAdapter(context, "http://example.com"),
    ).toThrow(TypeError);
    expect(
      () => new NativeWebMcpAdapter(context, "https://EXAMPLE.com"),
    ).toThrow(TypeError);
  });

  it("discovers same-origin read-only tools and executes the exact opaque handle", async () => {
    const handle = tool({ title: "Current search" });
    const context = new FakeModelContext([handle]);
    context.result = { route: "TLV-LHR", price: 420 };
    const adapter = new NativeWebMcpAdapter(context, ORIGIN);
    const discoverySignal = new AbortController().signal;

    await expect(adapter.capabilities(discoverySignal)).resolves.toEqual([
      {
        source: "native_webmcp",
        name: "flights.current_search",
        title: "Current search",
        description: "Read the current flight search.",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: READ_ONLY_ANNOTATIONS,
      },
    ]);
    expect(context.getToolsArgs).toEqual([[]]);

    const args = { cabin: "economy" };
    const execution = new AbortController();
    await expect(
      adapter.execute(handle.name, args, execution.signal),
    ).resolves.toEqual(context.result);
    expect(context.executeCalls).toHaveLength(1);
    expect(context.executeCalls[0]?.tool).toBe(handle);
    expect(context.executeCalls[0]?.input).toEqual(args);
    expect(context.executeCalls[0]?.input).not.toBe(args);
    expect(context.executeCalls[0]?.options.signal).toBe(execution.signal);
  });

  it("omits empty titles and rejects unsafe candidates without reading accessors", async () => {
    let accessed = false;
    const accessor = tool();
    Object.defineProperty(accessor, "name", {
      enumerable: true,
      get() {
        accessed = true;
        return "secrets.read";
      },
    });
    const context = new FakeModelContext([
      tool({ title: "" }),
      tool({
        name: "write.action",
        annotations: annotations({ readOnlyHint: false }),
      }),
      tool({
        name: "write.consequential",
        annotations: annotations({ consequentialHint: true }),
      }),
      tool({
        name: "unsafe.trusted",
        annotations: annotations({ untrustedContentHint: false }),
      }),
      tool({ name: "cross.origin", origin: "https://attacker.example" }),
      tool({ name: "schema.missing", inputSchema: undefined }),
      tool({ name: "schema.array", inputSchema: { type: "array" } }),
      tool({ name: "not_namespaced" }),
      { ...tool({ name: "future.field" }), future: true },
      {
        ...tool({ name: "future.annotation" }),
        annotations: { ...READ_ONLY_ANNOTATIONS, future: true },
      },
      accessor,
      new Proxy(tool(), {
        getPrototypeOf() {
          throw new Error("hostile metadata trap");
        },
      }),
    ]);
    const adapter = new NativeWebMcpAdapter(context, ORIGIN);

    await expect(
      adapter.capabilities(new AbortController().signal),
    ).resolves.toEqual([
      {
        source: "native_webmcp",
        name: "flights.current_search",
        description: "Read the current flight search.",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: READ_ONLY_ANNOTATIONS,
      },
    ]);
    expect(accessed).toBe(false);
  });

  it("omits every ambiguous native name without falling back to either handle", async () => {
    const context = new FakeModelContext([
      tool(),
      tool({ description: "A conflicting registration." }),
      tool({ name: "flights.price_insights" }),
    ]);
    const adapter = new NativeWebMcpAdapter(context, ORIGIN);

    await expect(
      adapter.capabilities(new AbortController().signal),
    ).resolves.toEqual([
      expect.objectContaining({ name: "flights.price_insights" }),
    ]);
    await expect(
      adapter.execute(
        "flights.current_search",
        {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "TOOL_UNAVAILABLE" });
  });

  it("bounds discovery and maps draft failures to payload-free adapter errors", async () => {
    const malformed = new NativeWebMcpAdapter(
      new FakeModelContext({ tools: "not-an-array" }),
      ORIGIN,
    );
    await expectAdapterError(
      malformed.capabilities(new AbortController().signal),
      "EXECUTION_FAILED",
    );

    const tooMany = new NativeWebMcpAdapter(
      new FakeModelContext(Array.from({ length: 129 }, () => tool())),
      ORIGIN,
    );
    await expectAdapterError(
      tooMany.capabilities(new AbortController().signal),
      "EXECUTION_FAILED",
    );

    const failed = new FakeModelContext([]);
    failed.getToolsError = new Error("sensitive page failure");
    const adapter = new NativeWebMcpAdapter(failed, ORIGIN);
    const error = await captureError(
      adapter.capabilities(new AbortController().signal),
    );
    expect(error).toBeInstanceOf(PageAdapterExecutionError);
    expect(error).toMatchObject({ code: "EXECUTION_FAILED" });
    expect(error.message).not.toContain("sensitive page failure");
  });

  it("revokes handles before toolchange notification and refreshes atomically", async () => {
    const first = tool();
    const second = tool({ name: "flights.price_insights" });
    const context = new FakeModelContext([first]);
    const adapter = new NativeWebMcpAdapter(context, ORIGIN);
    await adapter.capabilities(new AbortController().signal);
    let unavailableDuringNotification = false;
    const unsubscribe = adapter.subscribe(() => {
      void adapter
        .execute(first.name, {}, new AbortController().signal)
        .catch((error: unknown) => {
          unavailableDuringNotification =
            error instanceof PageAdapterExecutionError &&
            error.code === "TOOL_UNAVAILABLE";
        });
    });

    context.tools = [second];
    context.emitToolchange();
    await Promise.resolve();
    expect(unavailableDuringNotification).toBe(true);
    await expect(
      adapter.capabilities(new AbortController().signal),
    ).resolves.toEqual([expect.objectContaining({ name: second.name })]);

    unsubscribe();
    expect(context.listenerCount).toBe(0);
  });

  it("cancels stale discovery and forwards cancellation through execution", async () => {
    let resolveDiscovery: ((value: unknown) => void) | undefined;
    const context = new FakeModelContext([]);
    context.getToolsImplementation = () =>
      new Promise((resolve) => {
        resolveDiscovery = resolve;
      });
    const adapter = new NativeWebMcpAdapter(context, ORIGIN);
    const discovery = new AbortController();
    const pending = adapter.capabilities(discovery.signal);
    discovery.abort();
    resolveDiscovery?.([tool()]);
    await expectAdapterError(pending, "CANCELLED");

    context.getToolsImplementation = undefined;
    context.tools = [tool()];
    await adapter.capabilities(new AbortController().signal);
    const execution = new AbortController();
    context.executeImplementation = async (_tool, _input, options) => {
      expect(options.signal).toBe(execution.signal);
      execution.abort();
      throw new DOMException("page details", "AbortError");
    };
    await expectAdapterError(
      adapter.execute("flights.current_search", {}, execution.signal),
      "CANCELLED",
    );
  });

  it("rejects unsafe results without invoking accessors", async () => {
    let accessed = false;
    const result = {};
    Object.defineProperty(result, "secret", {
      enumerable: true,
      get() {
        accessed = true;
        return "must-not-run";
      },
    });
    const context = new FakeModelContext([tool()]);
    context.result = result;
    const adapter = new NativeWebMcpAdapter(context, ORIGIN);
    await adapter.capabilities(new AbortController().signal);

    await expectAdapterError(
      adapter.execute(
        "flights.current_search",
        {},
        new AbortController().signal,
      ),
      "RESULT_INVALID",
    );
    expect(accessed).toBe(false);
  });
});

class FakeModelContext implements DraftModelContext {
  tools: unknown;
  result: unknown = null;
  getToolsError: unknown;
  getToolsImplementation: (() => Promise<unknown>) | undefined;
  executeImplementation: DraftModelContext["executeTool"] | undefined;
  readonly getToolsArgs: unknown[][] = [];
  readonly executeCalls: Array<{
    readonly tool: DraftRegisteredTool;
    readonly input: unknown;
    readonly options: { readonly signal: AbortSignal };
  }> = [];
  readonly #listeners = new Set<() => void>();

  constructor(tools: unknown) {
    this.tools = tools;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  async getTools(...args: unknown[]): Promise<unknown> {
    this.getToolsArgs.push(args);
    if (this.getToolsError !== undefined) throw this.getToolsError;
    return this.getToolsImplementation?.() ?? this.tools;
  }

  async executeTool(
    value: DraftRegisteredTool,
    input: unknown,
    options: { readonly signal: AbortSignal },
  ): Promise<unknown> {
    this.executeCalls.push({ tool: value, input, options });
    return this.executeImplementation?.(value, input, options) ?? this.result;
  }

  addEventListener(type: "toolchange", listener: () => void): void {
    if (type === "toolchange") this.#listeners.add(listener);
  }

  removeEventListener(type: "toolchange", listener: () => void): void {
    if (type === "toolchange") this.#listeners.delete(listener);
  }

  emitToolchange(): void {
    for (const listener of this.#listeners) listener();
  }
}

function tool(
  overrides: Partial<Record<keyof DraftRegisteredTool, unknown>> = {},
): DraftRegisteredTool {
  return {
    name: "flights.current_search",
    description: "Read the current flight search.",
    inputSchema: { type: "object", additionalProperties: false },
    window: Object.freeze({ opaque: true }),
    origin: ORIGIN,
    annotations: READ_ONLY_ANNOTATIONS,
    ...overrides,
  } as DraftRegisteredTool;
}

function annotations(
  overrides: Partial<Record<keyof typeof READ_ONLY_ANNOTATIONS, boolean>>,
): Record<string, boolean> {
  return { ...READ_ONLY_ANNOTATIONS, ...overrides };
}

async function expectAdapterError(
  promise: Promise<unknown>,
  code: PageAdapterExecutionError["code"],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected promise to reject");
}
