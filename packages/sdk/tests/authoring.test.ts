import { describe, expect, expectTypeOf, it } from "vitest";

import {
  PackManifestValidationError,
  definePack,
  defineTool,
  type PackExecutionContext,
} from "../src/index.js";

const inputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string" },
    repeat: { type: "integer" },
  },
  required: ["message"],
} as const;

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    echoed: { type: "string" },
  },
  required: ["echoed"],
} as const;

const echo = defineTool({
  name: "mcpatch.demo.echo",
  description: "Echo a fixture value",
  risk: "read",
  permissions: ["READ"],
  inputSchema,
  outputSchema,
  execute(context, input) {
    expectTypeOf(context).toEqualTypeOf<PackExecutionContext>();
    expectTypeOf(input.message).toEqualTypeOf<string>();
    expectTypeOf(input.repeat).toEqualTypeOf<number | undefined>();
    return { echoed: input.message };
  },
});

describe("pack authoring primitives", () => {
  it("derives immutable manifest data and a separate handler table", async () => {
    const definition = definePack(basePack([echo]));
    const handler = definition.handlers["mcpatch.demo.echo"];

    expect(Object.isFrozen(echo)).toBe(true);
    expect(Object.isFrozen(echo.manifest)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.manifest)).toBe(true);
    expect(Object.isFrozen(definition.handlers)).toBe(true);
    expect(Object.keys(definition.handlers)).toEqual(["mcpatch.demo.echo"]);
    expect(definition.manifest.tools).toEqual([echo.manifest]);
    expect(JSON.stringify(definition.manifest)).not.toContain("execute");
    expect(JSON.stringify(definition.manifest)).not.toContain("function");
    expect(handler).toBe(echo.execute);

    const result = await handler(context(), { message: "safe" });
    expect(result).toEqual({ echoed: "safe" });
  });

  it("detaches serializable metadata from mutable author input", () => {
    const mutable = {
      name: "mcpatch.demo.mutable",
      description: "Read a mutable value",
      risk: "read" as const,
      permissions: ["READ" as const],
      inputSchema: structuredClone(inputSchema),
      outputSchema: structuredClone(outputSchema),
      execute: () => ({ echoed: "safe" }),
    };

    const tool = defineTool(mutable);
    mutable.description = "changed";
    (
      mutable.inputSchema as {
        properties: { message: { type: string } };
      }
    ).properties.message.type = "number";

    expect(tool.manifest.description).toBe("Read a mutable value");
    expect(tool.manifest.inputSchema).toEqual(inputSchema);
  });

  it("rejects unsafe tool metadata and unknown authoring fields", () => {
    expect(() =>
      defineTool({
        ...echoInput("mcpatch.demo.denied"),
        risk: "sensitive",
        permissions: ["READ"],
      }),
    ).toThrowError(
      expect.objectContaining({
        issue: { code: "INVALID_PERMISSION", field: "tool.risk" },
      }),
    );

    expect(() =>
      defineTool({
        ...echoInput("mcpatch.demo.remote"),
        remoteScript: "https://example.com/pack.js",
      } as never),
    ).toThrowError(
      expect.objectContaining({
        issue: { code: "UNKNOWN_FIELD", field: "tool.remoteScript" },
      }),
    );

    expect(() =>
      defineTool({
        ...echoInput("mcpatch.demo.invalid-handler"),
        execute: "not-a-function",
      } as never),
    ).toThrowError(
      expect.objectContaining({
        issue: { code: "INVALID_TYPE", field: "tool.execute" },
      }),
    );
  });

  it("rejects unknown pack fields and accessors without invoking them", () => {
    expect(() =>
      definePack({
        ...basePack([echo]),
        remoteScript: "https://example.com/pack.js",
      } as never),
    ).toThrowError(
      expect.objectContaining({
        issue: { code: "UNKNOWN_FIELD", field: "$.remoteScript" },
      }),
    );

    let accessed = false;
    const accessor = basePack([echo]);
    Object.defineProperty(accessor, "publisher", {
      enumerable: true,
      get() {
        accessed = true;
        return "mcpatch";
      },
    });
    expect(() => definePack(accessor)).toThrowError(
      expect.objectContaining({
        issue: { code: "INVALID_TYPE", field: "$.publisher" },
      }),
    );
    expect(accessed).toBe(false);
  });

  it("rejects unbranded, duplicate, and publisher-mismatched tools", () => {
    const fake = {
      manifest: echo.manifest,
      execute: echo.execute,
    };
    expect(() => definePack(basePack([fake]) as never)).toThrowError(
      expect.objectContaining({
        issue: { code: "INVALID_TYPE", field: "tools[0]" },
      }),
    );
    expect(() => definePack(basePack([echo, echo]))).toThrowError(
      expect.objectContaining({
        issue: { code: "DUPLICATE_VALUE", field: "tools[1].name" },
      }),
    );

    const other = defineTool(echoInput("other.demo.echo"));
    expect(() => definePack(basePack([other]))).toThrowError(
      expect.objectContaining({
        issue: { code: "INVALID_IDENTIFIER", field: "tools[0].name" },
      }),
    );
  });

  it("uses payload-free manifest errors", () => {
    const privateMarker = "private-authoring-marker";
    try {
      defineTool({
        ...echoInput("mcpatch.demo.marker"),
        description: privateMarker.repeat(100),
      });
      expect.unreachable("invalid definition must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PackManifestValidationError);
      expect(String(error)).not.toContain(privateMarker);
    }
  });
});

function echoInput(name: string) {
  return {
    name,
    description: "Echo a fixture value",
    risk: "read" as const,
    permissions: ["READ" as const],
    inputSchema,
    outputSchema,
    execute: (_context: PackExecutionContext, input: { message: string }) => ({
      echoed: input.message,
    }),
  };
}

function basePack<TTools extends readonly unknown[]>(tools: TTools) {
  return {
    manifestVersion: 1 as const,
    publisher: "mcpatch",
    id: "demo-pack",
    name: "Demo pack",
    description: "A deterministic SDK fixture pack",
    version: "0.1.0",
    digest: `sha256:${"a".repeat(64)}`,
    compatibility: {
      runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
      bridgeProtocol: { minimum: 1, maximum: 1 },
    },
    execution: { kind: "bundled" as const },
    matches: [
      {
        origin: "https://example.com",
        paths: [{ kind: "prefix" as const, path: "/demo/" }],
      },
    ],
    networkPolicy: { extensionRequests: "none" as const },
    tools,
    fixtures: [
      {
        id: "echo-result",
        tool: "mcpatch.demo.echo" as const,
        input: { message: "safe" },
        expect: { kind: "result" as const, result: { echoed: "safe" } },
      },
    ],
  };
}

function context(): PackExecutionContext {
  return Object.freeze({
    contextId: "tab-1",
    origin: "https://example.com",
    signal: new AbortController().signal,
  });
}
