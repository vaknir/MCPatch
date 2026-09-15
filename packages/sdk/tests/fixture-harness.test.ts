import { describe, expect, it, vi } from "vitest";

import {
  PackToolExecutionError,
  verifyPackFixtures,
  type PackVerificationResult,
} from "../src/index.js";
import {
  fixtureDefinition,
  verificationOptions,
} from "./support/fixture-definition.js";

describe("pack fixture execution", () => {
  it("returns deterministic, immutable compatibility evidence", async () => {
    const definition = fixtureDefinition({
      handler: () => ({ echoed: "safe" }),
    });

    const first = await verifyPackFixtures(definition, verificationOptions);
    const second = await verifyPackFixtures(definition, verificationOptions);

    expect(first).toEqual(second);
    expect(first).toEqual({
      ok: true,
      evidence: {
        evidenceVersion: 1,
        pack: {
          publisher: "mcpatch",
          id: "fixture-pack",
          version: "0.1.0",
          digest: `sha256:${"f".repeat(64)}`,
        },
        environment: {
          runtimeVersion: "0.1.0",
          bridgeProtocolVersion: 1,
          allowedPermissions: ["READ"],
        },
        checks: {
          runtime: { status: "passed" },
          bridgeProtocol: { status: "passed" },
          permissions: { status: "passed" },
          schemas: { status: "passed" },
          fixtures: { status: "passed" },
        },
        fixtures: [
          {
            id: "echo",
            tool: "mcpatch.fixture.echo",
            status: "passed",
          },
        ],
        summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
        passed: true,
      },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(
      "evidence" in first && Object.isFrozen(first.evidence.fixtures[0]),
    ).toBe(true);
  });

  it("accepts exact typed-error expectations", async () => {
    const definition = fixtureDefinition({
      expectation: { kind: "error", code: "CAPABILITY_DENIED" },
      handler: () => {
        throw new PackToolExecutionError("CAPABILITY_DENIED");
      },
    });

    const result = await verifyPackFixtures(definition, verificationOptions);

    expect(result.ok).toBe(true);
    expect(evidence(result).fixtures[0]).toEqual({
      id: "echo",
      tool: "mcpatch.fixture.echo",
      status: "passed",
    });
  });

  it("rejects schema-invalid results without including values", async () => {
    const privateMarker = "private-result-marker";
    const definition = fixtureDefinition({
      handler: () => ({ echoed: 42, privateMarker }),
    });

    const result = await verifyPackFixtures(definition, verificationOptions);

    expect(result.ok).toBe(true);
    expect(evidence(result).passed).toBe(false);
    expect(evidence(result).fixtures[0]).toEqual({
      id: "echo",
      tool: "mcpatch.fixture.echo",
      status: "failed",
      code: "RESULT_INVALID",
    });
    expect(JSON.stringify(result)).not.toContain(privateMarker);
  });

  it("compares JSON results independently of object key order", async () => {
    const definition = fixtureDefinition({
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          first: { type: "string" },
          second: { type: "string" },
        },
        required: ["first", "second"],
      },
      expectation: {
        kind: "result",
        result: { first: "one", second: "two" },
      },
      handler: () => ({ second: "two", first: "one" }),
    });

    const result = await verifyPackFixtures(definition, verificationOptions);

    expect(evidence(result).fixtures[0]?.status).toBe("passed");
  });

  it.each([
    {
      name: "a mismatched result",
      expectation: { kind: "result", result: { echoed: "expected" } } as const,
      handler: () => ({ echoed: "actual" }),
      code: "RESULT_MISMATCH",
    },
    {
      name: "a missing expected error",
      expectation: { kind: "error", code: "CAPABILITY_DENIED" } as const,
      handler: () => ({ echoed: "safe" }),
      code: "EXPECTED_ERROR_MISSING",
    },
    {
      name: "a different typed error",
      expectation: { kind: "error", code: "CAPABILITY_DENIED" } as const,
      handler: () => {
        throw new PackToolExecutionError("ORIGIN_MISMATCH");
      },
      code: "ERROR_CODE_MISMATCH",
    },
    {
      name: "an untyped error",
      expectation: { kind: "error", code: "CAPABILITY_DENIED" } as const,
      handler: () => {
        throw new Error("private failure details");
      },
      code: "UNEXPECTED_ERROR",
    },
  ])("reports $name safely", async ({ expectation, handler, code }) => {
    const result = await verifyPackFixtures(
      fixtureDefinition({ expectation, handler }),
      verificationOptions,
    );

    expect(evidence(result).fixtures[0]).toEqual({
      id: "echo",
      tool: "mcpatch.fixture.echo",
      status: "failed",
      code,
    });
    expect(JSON.stringify(result)).not.toContain("private failure details");
  });

  it("turns a deadline into a typed timeout and aborts the handler", async () => {
    const aborted = vi.fn();
    const definition = fixtureDefinition({
      expectation: { kind: "error", code: "TIMEOUT" },
      handler: (context) =>
        new Promise<never>(() => {
          context.signal.addEventListener("abort", aborted);
        }),
    });

    const result = await verifyPackFixtures(definition, {
      ...verificationOptions,
      timeoutMs: 10,
    });

    expect(result.ok).toBe(true);
    expect(evidence(result).passed).toBe(true);
    expect(aborted).toHaveBeenCalledOnce();
  });
});

function evidence(result: PackVerificationResult) {
  if (!result.ok) throw new Error("expected evidence");
  return result.evidence;
}
