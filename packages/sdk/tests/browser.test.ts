import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  BrowserToolExecutionError,
  MCPatch,
  type BrowserToolContext,
} from "../src/browser.js";
import { PackToolExecutionError } from "../src/index.js";

interface TestDocument {
  readonly prefix: string;
}

interface TestSite {
  enabled: boolean;
  readonly prefix: string;
}

const inputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: { message: { type: "string" } },
} as const;

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value"],
  properties: { value: { type: "string" } },
} as const;

/** Page services the extension grants a pack: gated navigation only. */
const SERVICES = { navigate: () => {} };

describe("browser MCPatch authoring", () => {
  it("hands navigation to an approved action and refuses it to a read", async () => {
    const navigate = vi.fn();
    const mcp = new MCPatch<TestSite, TestDocument>(packOptions());
    mcp.tool(
      {
        name: "mcpatch.browser.read_only",
        description: "A read tool that reaches for navigation.",
        risk: "read",
        inputSchema,
        outputSchema,
      },
      (_input, context) => {
        // A read handler does not receive `navigate` in its context type; this
        // proves it is also refused at runtime.
        (context as unknown as { navigate: (url: string) => void }).navigate(
          "https://example.com/app/x",
        );
        return { value: "unreachable" };
      },
    );
    mcp.tool(
      {
        name: "mcpatch.browser.act",
        description: "An approved action that navigates.",
        risk: "action",
        inputSchema,
        outputSchema,
      },
      (_input, context) => {
        context.navigate("https://example.com/app/x");
        return { value: "navigated" };
      },
    );
    const built = mcp.build({
      fixtures: [
        {
          id: "read-only-fallback",
          tool: "mcpatch.browser.read_only",
          input: { message: "safe" },
          expect: { kind: "error" as const, code: "TOOL_NOT_FOUND" as const },
        },
        {
          id: "act-fallback",
          tool: "mcpatch.browser.act",
          input: { message: "safe" },
          expect: { kind: "error" as const, code: "TOOL_NOT_FOUND" as const },
        },
      ],
      create: (document) => ({ enabled: true, prefix: document.prefix }),
    });
    const adapter = built.page.create({ prefix: "page" }, { navigate });

    await expect(
      adapter.execute("mcpatch.browser.act", {}, signal()),
    ).resolves.toEqual({ value: "navigated" });
    expect(navigate).toHaveBeenCalledWith("https://example.com/app/x");

    navigate.mockClear();
    await expect(
      adapter.execute("mcpatch.browser.read_only", {}, signal()),
    ).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("builds one compiled definition and generated page adapter", async () => {
    const mcp = new MCPatch<TestSite, TestDocument>(packOptions());
    const echo = mcp.tool(
      {
        name: "mcpatch.browser.echo",
        description: "Echo through the current site",
        risk: "read",
        inputSchema,
        outputSchema,
      },
      (input, context) => {
        expectTypeOf(input.message).toEqualTypeOf<string>();
        expectTypeOf(context).toEqualTypeOf<BrowserToolContext<TestSite>>();
        return { value: `${context.site.prefix}:${input.message}` };
      },
    );
    mcp.tool(
      {
        name: "mcpatch.browser.conditional",
        description: "Return a conditionally available value",
        risk: "read",
        inputSchema,
        outputSchema,
      },
      (input) => ({ value: input.message }),
      { available: ({ site }) => site.enabled },
    );
    let notify: (() => void) | undefined;
    const cleanup = vi.fn();
    const built = mcp.build({
      fixtures: fallbackFixtures(),
      create: (document) => ({ enabled: false, prefix: document.prefix }),
      subscribe: (_site, changed) => {
        notify = changed;
        return cleanup;
      },
    });

    expect(echo({ message: "direct" }, browserContext())).toEqual({
      value: "direct:direct",
    });
    expect(Object.keys(built)).toEqual(["definition", "page"]);
    expect(Object.isFrozen(built)).toBe(true);
    expect(built.page.pack).toBe(built.definition);
    expect(built.definition.manifest).toMatchObject({
      manifestVersion: 1,
      compatibility: {
        runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
        bridgeProtocol: { minimum: 2, maximum: 2 },
      },
      execution: { kind: "bundled" },
      networkPolicy: { extensionRequests: "none" },
    });
    expect(built.definition.manifest.tools[0]?.permissions).toEqual(["READ"]);
    expect(built.page.tools).toEqual([
      "mcpatch.browser.echo",
      "mcpatch.browser.conditional",
    ]);

    const adapter = built.page.create({ prefix: "page" }, SERVICES);
    await expect(adapter.capabilities(signal())).resolves.toEqual([
      { source: "pack", name: "mcpatch.browser.echo" },
    ]);
    await expect(
      adapter.execute("mcpatch.browser.echo", { message: "hello" }, signal()),
    ).resolves.toEqual({ value: "page:hello" });
    await expect(
      adapter.execute(
        "mcpatch.browser.conditional",
        { message: "hidden" },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "TOOL_UNAVAILABLE" });

    const changed = vi.fn();
    const unsubscribe = adapter.subscribe(changed);
    notify?.();
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();

    await expect(
      built.definition.handlers["mcpatch.browser.echo"]?.(packContext(), {
        message: "denied",
      } as never),
    ).rejects.toBeInstanceOf(PackToolExecutionError);
  });

  it("supports one efficient pack-level discovery callback", async () => {
    const mcp = new MCPatch<TestSite, TestDocument>(packOptions());
    registerEcho(mcp, "mcpatch.browser.echo");
    registerEcho(mcp, "mcpatch.browser.other");
    const discover = vi.fn(() => ["mcpatch.browser.other"] as const);
    const built = mcp.build({
      fixtures: fallbackFixtures("other"),
      create: (document) => ({ enabled: true, prefix: document.prefix }),
      discover,
    });

    const capabilities = await built.page
      .create({ prefix: "page" }, SERVICES)
      .capabilities(signal());

    expect(discover).toHaveBeenCalledTimes(1);
    expect(capabilities).toEqual([
      { source: "pack", name: "mcpatch.browser.other" },
    ]);
  });

  it("fails closed for unknown tools, invalid discovery, and cancellation", async () => {
    const mcp = new MCPatch<TestSite, TestDocument>(packOptions());
    registerEcho(mcp, "mcpatch.browser.echo");
    const built = mcp.build({
      fixtures: fallbackFixtures("echo", false),
      create: (document) => ({ enabled: true, prefix: document.prefix }),
      discover: () => ["mcpatch.browser.undeclared"],
    });
    const adapter = built.page.create({ prefix: "page" }, SERVICES);

    await expect(adapter.capabilities(signal())).rejects.toMatchObject({
      code: "EXECUTION_FAILED",
    });
    await expect(
      adapter.execute("mcpatch.browser.unknown", {}, signal()),
    ).rejects.toMatchObject({ code: "TOOL_UNAVAILABLE" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.execute(
        "mcpatch.browser.echo",
        { message: "cancel" },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("normalizes browser handler failures without exposing their messages", async () => {
    const privateMessage = "private-page-value";
    const mcp = new MCPatch<TestSite, TestDocument>(packOptions());
    mcp.tool(
      {
        name: "mcpatch.browser.echo",
        description: "Fail safely",
        risk: "read",
        inputSchema,
        outputSchema,
      },
      () => {
        throw new Error(privateMessage);
      },
    );
    const built = mcp.build({
      fixtures: fallbackFixtures("echo", false),
      create: (document) => ({ enabled: true, prefix: document.prefix }),
    });

    try {
      await built.page
        .create({ prefix: "page" }, SERVICES)
        .execute("mcpatch.browser.echo", { message: "fail" }, signal());
      expect.unreachable("handler must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserToolExecutionError);
      expect(error).toMatchObject({ code: "EXECUTION_FAILED" });
      expect(String(error)).not.toContain(privateMessage);
    }
  });
});

function registerEcho(
  mcp: MCPatch<TestSite, TestDocument>,
  name: `mcpatch.browser.${string}`,
): void {
  mcp.tool(
    {
      name,
      description: "Echo through the current site",
      risk: "read",
      inputSchema,
      outputSchema,
    },
    (input, { site }) => ({ value: `${site.prefix}:${input.message}` }),
  );
}

function fallbackFixtures(second = "conditional", includeSecond = true) {
  return [
    {
      id: "echo-fallback",
      tool: "mcpatch.browser.echo",
      input: { message: "safe" },
      expect: { kind: "error" as const, code: "TOOL_NOT_FOUND" as const },
    },
    ...(includeSecond
      ? [
          {
            id: `${second}-fallback`,
            tool: `mcpatch.browser.${second}`,
            input: { message: "safe" },
            expect: {
              kind: "error" as const,
              code: "TOOL_NOT_FOUND" as const,
            },
          },
        ]
      : []),
  ];
}

function packOptions() {
  return {
    publisher: "mcpatch",
    id: "browser-pack",
    name: "Browser pack",
    description: "A deterministic browser SDK fixture pack",
    version: "0.1.0",
    digest: `sha256:${"b".repeat(64)}`,
    matches: [
      {
        origin: "https://example.com",
        paths: [{ kind: "prefix" as const, path: "/" }],
        wholeOrigin: true as const,
      },
    ],
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

function browserContext(): BrowserToolContext<TestSite> {
  return Object.freeze({
    site: { enabled: true, prefix: "direct" },
    signal: signal(),
  });
}

function packContext() {
  return Object.freeze({
    contextId: "tab-1",
    origin: "https://example.com",
    signal: signal(),
  });
}
