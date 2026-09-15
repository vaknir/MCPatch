import { describe, expect, expectTypeOf, it } from "vitest";

import {
  MCPatch,
  PackManifestValidationError,
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
  properties: { echoed: { type: "string" } },
  required: ["echoed"],
} as const;

describe("MCPatch authoring", () => {
  it("registers typed tools with a FastMCP-style API", async () => {
    const mcp = new MCPatch(packOptions());
    const handler = mcp.tool(
      {
        name: "mcpatch.demo.echo",
        description: "Echo a fixture value",
        risk: "read",
        permissions: ["READ"],
        inputSchema,
        outputSchema,
      },
      (input, context) => {
        expectTypeOf(input.message).toEqualTypeOf<string>();
        expectTypeOf(input.repeat).toEqualTypeOf<number | undefined>();
        expectTypeOf(context).toEqualTypeOf<PackExecutionContext>();
        return { echoed: input.message };
      },
    );
    const definition = mcp.build({
      fixtures: [
        {
          id: "echo-result",
          tool: "mcpatch.demo.echo",
          input: { message: "safe" },
          expect: { kind: "result", result: { echoed: "safe" } },
        },
      ],
    });

    expect(typeof handler).toBe("function");
    expect(handler({ message: "direct" }, context())).toEqual({
      echoed: "direct",
    });
    expect(definition.manifest.tools).toEqual([
      expect.objectContaining({ name: "mcpatch.demo.echo" }),
    ]);
    expect(JSON.stringify(definition.manifest)).not.toContain("execute");
    const routed = await definition.handlers["mcpatch.demo.echo"]?.(context(), {
      message: "routed",
    } as never);
    expect(routed).toEqual({ echoed: "routed" });
  });

  it("snapshots pack and tool metadata at registration boundaries", () => {
    const mutableOptions = packOptions();
    const mutableInput = structuredClone(inputSchema) as {
      type: "object";
      additionalProperties: false;
      properties: { message: { type: string }; repeat: { type: "integer" } };
      required: ["message"];
    };
    const mcp = new MCPatch(mutableOptions);
    mcp.tool(
      {
        name: "mcpatch.demo.echo",
        description: "Echo a fixture value",
        risk: "read",
        permissions: ["READ"],
        inputSchema: mutableInput,
        outputSchema,
      },
      () => ({ echoed: "safe" }),
    );

    mutableOptions.name = "Changed pack";
    mutableInput.properties.message.type = "number";
    const definition = mcp.build({
      fixtures: [
        {
          id: "echo-result",
          tool: "mcpatch.demo.echo",
          input: { message: "safe" },
          expect: { kind: "result", result: { echoed: "safe" } },
        },
      ],
    });

    expect(definition.manifest.name).toBe("Demo pack");
    expect(definition.manifest.tools[0]?.inputSchema).toEqual(inputSchema);
  });

  it("rejects duplicate tools and locks registration after build", () => {
    const mcp = new MCPatch(packOptions());
    const register = () =>
      mcp.tool(
        {
          name: "mcpatch.demo.echo",
          description: "Echo a fixture value",
          risk: "read",
          permissions: ["READ"],
          inputSchema,
          outputSchema,
        },
        (input) => ({ echoed: input.message }),
      );
    register();
    expect(register).toThrowError(
      expect.objectContaining({
        issue: { code: "DUPLICATE_VALUE", field: "tool.name" },
      }),
    );

    mcp.build({
      fixtures: [
        {
          id: "echo-result",
          tool: "mcpatch.demo.echo",
          input: { message: "safe" },
          expect: { kind: "result", result: { echoed: "safe" } },
        },
      ],
    });
    expect(register).toThrowError("MCPatch pack is already built");
    expect(() => mcp.build({ fixtures: [] })).toThrowError(
      "MCPatch pack is already built",
    );
  });

  it("rejects publisher mismatches and unsafe authoring objects", () => {
    const mcp = new MCPatch(packOptions());
    expect(() =>
      mcp.tool(
        {
          name: "other.demo.echo",
          description: "Echo a fixture value",
          risk: "read",
          permissions: ["READ"],
          inputSchema,
          outputSchema,
        },
        (input) => ({ echoed: input.message }),
      ),
    ).toThrowError(
      expect.objectContaining({
        issue: { code: "INVALID_IDENTIFIER", field: "tool.name" },
      }),
    );

    expect(
      () =>
        new MCPatch({
          ...packOptions(),
          remoteScript: "https://example.com/pack.js",
        } as never),
    ).toThrowError(
      expect.objectContaining({
        issue: { code: "UNKNOWN_FIELD", field: "pack.remoteScript" },
      }),
    );

    let accessed = false;
    const options = packOptions();
    Object.defineProperty(options, "name", {
      enumerable: true,
      get() {
        accessed = true;
        return "Unsafe";
      },
    });
    expect(() => new MCPatch(options)).toThrowError(
      PackManifestValidationError,
    );
    expect(accessed).toBe(false);

    let schemaAccessed = false;
    const unsafeSchema = structuredClone(inputSchema);
    Object.defineProperty(unsafeSchema.properties.message, "type", {
      enumerable: true,
      get() {
        schemaAccessed = true;
        return "string";
      },
    });
    expect(() =>
      new MCPatch(packOptions()).tool(
        {
          name: "mcpatch.demo.unsafe",
          description: "Reject an unsafe schema",
          risk: "read",
          permissions: ["READ"],
          inputSchema: unsafeSchema,
          outputSchema,
        },
        () => ({ echoed: "safe" }),
      ),
    ).toThrowError(
      expect.objectContaining({
        issue: {
          code: "INVALID_TYPE",
          field: "tool.inputSchema.properties.message.type",
        },
      }),
    );
    expect(schemaAccessed).toBe(false);
  });
});

function packOptions() {
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
  };
}

function context(): PackExecutionContext {
  return Object.freeze({
    contextId: "tab-1",
    origin: "https://example.com",
    signal: new AbortController().signal,
  });
}
