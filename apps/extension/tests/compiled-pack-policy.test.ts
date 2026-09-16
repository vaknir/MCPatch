import {
  DEMO_CONTEXT_ID,
  DEMO_ORIGIN,
  DEMO_TOOL_NAME,
  DEMO_URL,
} from "@mcpatch/example-packs";
import {
  PackToolExecutionError,
  type JsonObject,
  type PackExecutionContext,
} from "@mcpatch/sdk/runtime";
import { PROTOCOL_VERSION } from "@mcpatch/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  CompiledPackRuntime,
  type NativeRuntimeTool,
} from "../src/compiled-pack-runtime.js";
import {
  flushPromises,
  packRuntime,
  readyPackRuntime,
  testPack,
  type TestHandler,
  toolCall,
} from "./support/compiled-pack.js";

describe("compiled pack runtime policy", () => {
  it("preserves native WebMCP precedence and executes only the winner", async () => {
    const packExecute = vi.fn(() => ({ source: "pack" }));
    const nativeExecute = vi.fn(() => ({ source: "native" }));
    const definition = testPack(packExecute);
    const { runtime, sent } = packRuntime([definition]);
    const tool = definition.manifest.tools[0];
    if (tool === undefined) throw new Error("missing test tool");
    const native: NativeRuntimeTool = { tool, execute: nativeExecute };

    runtime.activateContext({
      contextId: DEMO_CONTEXT_ID,
      url: DEMO_URL,
      native: [native],
    });
    runtime.handle(toolCall());
    await flushPromises();

    expect(sent[0]).toMatchObject({
      type: "capability_snapshot",
      capabilities: [{ name: DEMO_TOOL_NAME, source: "native_webmcp" }],
    });
    expect(sent[1]).toMatchObject({ result: { source: "native" } });
    expect(nativeExecute).toHaveBeenCalledOnce();
    expect(packExecute).not.toHaveBeenCalled();
  });

  it("hides deterministic collisions instead of selecting by arrival order", () => {
    const first = testPack(() => ({ source: "first" }));
    const second = testPack(() => ({ source: "second" }), "second-demo");
    const { runtime, sent } = packRuntime([second, first]);

    const result = runtime.activateContext({
      contextId: DEMO_CONTEXT_ID,
      url: DEMO_URL,
      native: [],
    });

    expect(result).toEqual({ ok: true, published: false, contextRevision: 1 });
    expect(sent).toEqual([]);
  });

  it("binds a named handler to only the narrow execution context", async () => {
    const observed: Array<{
      context: PackExecutionContext;
      input: JsonObject;
    }> = [];
    const definition = testPack((context, input) => {
      observed.push({ context, input });
      return { source: "pack" };
    });
    const { runtime } = readyPackRuntime([definition]);

    runtime.handle(toolCall());
    await flushPromises();

    expect(observed).toHaveLength(1);
    expect(observed[0]?.context.contextId).toBe(DEMO_CONTEXT_ID);
    expect(observed[0]?.context.origin).toBe(DEMO_ORIGIN);
    expect(observed[0]?.context.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(observed[0]?.context ?? {})).toEqual([
      "contextId",
      "origin",
      "signal",
    ]);
  });

  it("rejects invalid output and preserves typed handler errors", async () => {
    const invalid = testPack((() => ({
      source: 42,
    })) as unknown as TestHandler);
    const invalidState = readyPackRuntime([invalid]);
    invalidState.runtime.handle(toolCall());
    await flushPromises();
    expect(invalidState.sent[1]).toMatchObject({
      type: "tool_error",
      code: "RESULT_INVALID",
    });

    const denied = testPack(() => {
      throw new PackToolExecutionError("CAPABILITY_DENIED");
    });
    const deniedState = readyPackRuntime([denied]);
    deniedState.runtime.handle(toolCall());
    await flushPromises();
    expect(deniedState.sent[1]).toMatchObject({
      type: "tool_error",
      code: "CAPABILITY_DENIED",
    });
  });

  it("cancels only the exact pending request without replying", async () => {
    const aborted = vi.fn();
    const definition = pendingPack(aborted);
    const { runtime, sent } = readyPackRuntime([definition]);
    runtime.handle(toolCall());
    await flushPromises();

    expect(
      runtime.handle({
        protocolVersion: PROTOCOL_VERSION,
        type: "cancel",
        requestId: "request-1",
      }),
    ).toBe(true);
    expect(aborted).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
  });

  it("revokes pending calls on navigation, disable, and disconnect", async () => {
    for (const event of ["navigation", "disable", "disconnect"] as const) {
      const aborted = vi.fn();
      const { runtime, sent } = readyPackRuntime([pendingPack(aborted)]);
      runtime.handle(toolCall());
      await flushPromises();

      if (event === "navigation") {
        runtime.activateContext({
          contextId: DEMO_CONTEXT_ID,
          url: "https://other.invalid/",
          native: [],
        });
      } else if (event === "disable") {
        runtime.disablePack("mcpatch", "builtin-demo");
      } else {
        runtime.disconnect();
      }

      expect(aborted).toHaveBeenCalledOnce();
      expect(sent.some((message) => message.type === "tool_result")).toBe(
        false,
      );
      expect(
        sent.filter((message) => message.type === "context_closed"),
      ).toEqual(
        event === "disconnect"
          ? []
          : [
              expect.objectContaining({
                reason: event === "navigation" ? "navigation" : "pack_disabled",
              }),
            ],
      );
    }
  });

  it("revokes old handlers and revisions when definitions are replaced", async () => {
    const oldExecute = vi.fn(() => ({ source: "old" }));
    const newExecute = vi.fn(() => ({ source: "new" }));
    const { runtime, sent } = readyPackRuntime([testPack(oldExecute)]);

    expect(runtime.replaceDefinitions([testPack(newExecute)])).toBe(true);
    expect(sent[1]).toMatchObject({
      type: "context_closed",
      contextRevision: 1,
      reason: "pack_disabled",
    });
    runtime.activateContext({
      contextId: DEMO_CONTEXT_ID,
      url: DEMO_URL,
      native: [],
    });
    runtime.handle(toolCall({ contextRevision: 2 }));
    await flushPromises();

    expect(newExecute).toHaveBeenCalledOnce();
    expect(oldExecute).not.toHaveBeenCalled();
  });

  it("fails closed when a replacement definition is incompatible", async () => {
    const execute = vi.fn(() => ({ source: "old" }));
    const definition = testPack(execute);
    const { runtime, sent } = readyPackRuntime([definition]);
    const manifest = staleManifest(definition.manifest);

    expect(
      runtime.replaceDefinitions([{ manifest, handlers: definition.handlers }]),
    ).toBe(false);
    expect(sent[1]).toMatchObject({
      type: "context_closed",
      reason: "pack_disabled",
    });
    runtime.handle(toolCall());
    await flushPromises();
    expect(sent[2]).toMatchObject({
      type: "tool_error",
      code: "CONTEXT_NOT_FOUND",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects incompatible, over-permissioned, and unsupported definitions", () => {
    const definition = testPack(() => ({ source: "safe" }));
    const permissionManifest = structuredClone(
      definition.manifest,
    ) as unknown as {
      tools: Array<{ risk: string; permissions: string[] }>;
    };
    const permissionTool = permissionManifest.tools[0];
    if (permissionTool === undefined) throw new Error("missing test tool");
    permissionTool.risk = "sensitive";
    permissionTool.permissions = ["SENSITIVE"];
    const unsupportedManifest = structuredClone(
      definition.manifest,
    ) as unknown as {
      tools: Array<{ inputSchema: Record<string, unknown> }>;
    };
    const unsupportedTool = unsupportedManifest.tools[0];
    if (unsupportedTool === undefined) throw new Error("missing test tool");
    unsupportedTool.inputSchema.pattern = "unsafe-runtime-keyword";

    for (const manifest of [
      staleManifest(definition.manifest),
      permissionManifest,
      unsupportedManifest,
    ]) {
      expect(
        () =>
          new CompiledPackRuntime(
            () => true,
            [{ manifest, handlers: definition.handlers }],
            {
              runtimeVersion: "0.1.0",
              bridgeProtocolVersion: 2,
              allowedPermissions: ["READ"],
            },
          ),
      ).toThrowError("compiled pack definitions were rejected");
    }
  });
});

function pendingPack(aborted: () => void) {
  return testPack(
    (context) =>
      new Promise<never>(() => {
        context.signal.addEventListener("abort", aborted);
      }),
  );
}

function staleManifest(manifest: unknown) {
  const stale = structuredClone(manifest) as {
    compatibility: {
      runtime: { minimum: string; maximumExclusive: string };
    };
  };
  stale.compatibility.runtime = {
    minimum: "1.0.0",
    maximumExclusive: "2.0.0",
  };
  return stale;
}
