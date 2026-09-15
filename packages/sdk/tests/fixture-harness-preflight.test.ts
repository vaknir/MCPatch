import { describe, expect, it, vi } from "vitest";

import {
  definePack,
  defineTool,
  verifyPackFixtures,
  type PackCompatibilityEvidence,
  type PackVerificationResult,
} from "../src/index.js";
import {
  fixtureDefinition,
  verificationOptions,
} from "./support/fixture-definition.js";

describe("pack fixture preflight", () => {
  it("rejects a malformed manifest before execution", async () => {
    const execute = vi.fn(() => ({ echoed: "safe" }));
    const definition = fixtureDefinition({ handler: execute });
    const manifest = structuredClone(definition.manifest) as unknown as Record<
      string,
      unknown
    >;
    manifest.manifestVersion = 2;

    const result = await verifyPackFixtures(
      { manifest, handlers: definition.handlers },
      verificationOptions,
    );

    expect(result).toEqual({
      ok: false,
      issue: {
        code: "INVALID_MANIFEST",
        field: "manifestVersion",
        manifestCode: "UNSUPPORTED_VERSION",
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a fixture that references an undeclared tool", async () => {
    const definition = fixtureDefinition();
    const manifest = structuredClone(definition.manifest) as unknown as {
      fixtures: Array<{ tool: string }>;
    };
    const fixture = manifest.fixtures[0];
    if (fixture === undefined) throw new Error("missing fixture");
    fixture.tool = "mcpatch.fixture.missing";

    const result = await verifyPackFixtures(
      { manifest, handlers: definition.handlers },
      verificationOptions,
    );

    expect(result).toEqual({
      ok: false,
      issue: {
        code: "INVALID_MANIFEST",
        field: "fixtures[0].tool",
        manifestCode: "INVALID_REFERENCE",
      },
    });
  });

  it.each([
    {
      name: "runtime below minimum",
      definition: fixtureDefinition({
        runtime: { minimum: "0.2.0", maximumExclusive: "0.3.0" },
      }),
      options: verificationOptions,
      check: "runtime",
      code: "RUNTIME_INCOMPATIBLE",
    },
    {
      name: "runtime at exclusive maximum",
      definition: fixtureDefinition(),
      options: { ...verificationOptions, runtimeVersion: "0.2.0" },
      check: "runtime",
      code: "RUNTIME_INCOMPATIBLE",
    },
    {
      name: "bridge protocol outside range",
      definition: fixtureDefinition(),
      options: { ...verificationOptions, bridgeProtocolVersion: 2 },
      check: "bridgeProtocol",
      code: "BRIDGE_PROTOCOL_INCOMPATIBLE",
    },
  ])("fails stale compatibility for $name", async (testCase) => {
    const result = await verifyPackFixtures(
      testCase.definition,
      testCase.options,
    );

    expect(result.ok).toBe(true);
    expect(
      evidence(result).checks[
        testCase.check as keyof PackCompatibilityEvidence["checks"]
      ],
    ).toEqual({
      status: "failed",
      code: testCase.code,
    });
    expect(evidence(result).fixtures[0]?.status).toBe("skipped");
  });

  it("denies permission expansion before execution", async () => {
    const execute = vi.fn(() => ({ echoed: "safe" }));
    const definition = fixtureDefinition({
      permissions: ["READ", "SENSITIVE"],
      handler: execute,
    });

    const result = await verifyPackFixtures(definition, verificationOptions);

    expect(evidence(result).checks.permissions).toEqual({
      status: "failed",
      code: "PERMISSION_EXPANSION",
    });
    expect(evidence(result).fixtures[0]?.status).toBe("skipped");
    expect(execute).not.toHaveBeenCalled();
  });

  it("compiles every schema and validates every fixture before execution", async () => {
    const execute = vi.fn(() => ({ echoed: "safe" }));
    const definition = fixtureDefinition({
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: "private malformed schema value" as never,
      },
      handler: execute,
    });

    const result = await verifyPackFixtures(definition, verificationOptions);

    expect(evidence(result).checks.schemas).toEqual({
      status: "failed",
      code: "SCHEMA_INVALID",
    });
    expect(evidence(result).fixtures[0]).toEqual({
      id: "echo",
      tool: "mcpatch.fixture.echo",
      status: "failed",
      code: "SCHEMA_INVALID",
    });
    expect(JSON.stringify(result)).not.toContain("private malformed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects asynchronous schemas so preflight stays deterministic", async () => {
    const execute = vi.fn(() => ({ echoed: "safe" }));
    const definition = fixtureDefinition({
      outputSchema: {
        $async: true,
        type: "object",
        properties: { echoed: { type: "string" } },
      },
      handler: execute,
    });

    const result = await verifyPackFixtures(definition, verificationOptions);

    expect(evidence(result).checks.schemas).toEqual({
      status: "failed",
      code: "SCHEMA_INVALID",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports invalid fixture input without executing any fixture", async () => {
    const first = vi.fn(() => ({ echoed: "safe" }));
    const second = vi.fn(() => ({ count: 1 }));
    const definition = twoToolDefinition(first, second);
    const manifest = structuredClone(definition.manifest) as unknown as {
      fixtures: Array<{ input: Record<string, unknown> }>;
    };
    const fixture = manifest.fixtures[1];
    if (fixture === undefined) throw new Error("missing fixture");
    fixture.input = { count: "not-an-integer" };

    const result = await verifyPackFixtures(
      { manifest, handlers: definition.handlers },
      verificationOptions,
    );

    expect(evidence(result).fixtures).toEqual([
      {
        id: "echo",
        tool: "mcpatch.fixture.echo",
        status: "skipped",
        code: "PREFLIGHT_FAILED",
      },
      {
        id: "count",
        tool: "mcpatch.fixture.count",
        status: "failed",
        code: "FIXTURE_INPUT_INVALID",
      },
    ]);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("rejects an invalid expected result during preflight", async () => {
    const execute = vi.fn(() => ({ echoed: "safe" }));
    const definition = fixtureDefinition({
      expectation: { kind: "result", result: { echoed: 42 } },
      handler: execute,
    });

    const result = await verifyPackFixtures(definition, verificationOptions);

    expect(evidence(result).fixtures[0]).toEqual({
      id: "echo",
      tool: "mcpatch.fixture.echo",
      status: "failed",
      code: "FIXTURE_EXPECTATION_INVALID",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects manifest array accessors without invoking them", async () => {
    const definition = fixtureDefinition();
    const manifest = structuredClone(definition.manifest);
    let accessed = false;
    Object.defineProperty(manifest.fixtures, 0, {
      enumerable: true,
      get() {
        accessed = true;
        return definition.manifest.fixtures[0];
      },
    });

    const result = await verifyPackFixtures(
      { manifest, handlers: definition.handlers },
      verificationOptions,
    );

    expect(result).toEqual({
      ok: false,
      issue: {
        code: "INVALID_MANIFEST",
        field: "$.fixtures[0]",
        manifestCode: "INVALID_TYPE",
      },
    });
    expect(accessed).toBe(false);
  });

  it("rejects a mismatched or accessor-based handler table", async () => {
    const definition = fixtureDefinition();
    let accessed = false;
    const handlers = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(handlers, "mcpatch.fixture.echo", {
      enumerable: true,
      get() {
        accessed = true;
        return definition.handlers["mcpatch.fixture.echo"];
      },
    });

    const accessorResult = await verifyPackFixtures(
      { manifest: definition.manifest, handlers },
      verificationOptions,
    );
    const missingResult = await verifyPackFixtures(
      { manifest: definition.manifest, handlers: {} },
      verificationOptions,
    );

    expect(accessorResult).toEqual({
      ok: false,
      issue: { code: "INVALID_HANDLER_TABLE", field: "handlers" },
    });
    expect(missingResult).toEqual({
      ok: false,
      issue: {
        code: "INVALID_HANDLER_TABLE",
        field: "handlers.mcpatch.fixture.echo",
      },
    });
    expect(accessed).toBe(false);
  });

  it("rejects malformed verification options", async () => {
    const result = await verifyPackFixtures(fixtureDefinition(), {
      ...verificationOptions,
      runtimeVersion: "0.1",
    });

    expect(result).toEqual({
      ok: false,
      issue: { code: "INVALID_OPTIONS", field: "options.runtimeVersion" },
    });
  });
});

function twoToolDefinition(
  first: () => { echoed: string },
  second: () => { count: number },
) {
  const echo = defineTool({
    name: "mcpatch.fixture.echo",
    description: "Echo",
    risk: "read",
    permissions: ["READ"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    outputSchema: { type: "object" },
    execute: first,
  });
  const count = defineTool({
    name: "mcpatch.fixture.count",
    description: "Count",
    risk: "read",
    permissions: ["READ"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { count: { type: "integer" } },
      required: ["count"],
    },
    outputSchema: { type: "object" },
    execute: second,
  });
  return definePack({
    manifestVersion: 1,
    publisher: "mcpatch",
    id: "fixture-pack",
    name: "Fixture pack",
    description: "Two tool fixture pack",
    version: "0.1.0",
    digest: `sha256:${"e".repeat(64)}`,
    compatibility: {
      runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
      bridgeProtocol: { minimum: 1, maximum: 1 },
    },
    execution: { kind: "bundled" },
    matches: [
      {
        origin: "https://example.com",
        paths: [{ kind: "prefix", path: "/fixtures/" }],
      },
    ],
    networkPolicy: { extensionRequests: "none" },
    tools: [echo, count],
    fixtures: [
      {
        id: "echo",
        tool: "mcpatch.fixture.echo",
        input: { value: "safe" },
        expect: { kind: "result", result: { echoed: "safe" } },
      },
      {
        id: "count",
        tool: "mcpatch.fixture.count",
        input: { count: 1 },
        expect: { kind: "result", result: { count: 1 } },
      },
    ],
  });
}

function evidence(result: PackVerificationResult) {
  if (!result.ok) throw new Error("expected evidence");
  return result.evidence;
}
