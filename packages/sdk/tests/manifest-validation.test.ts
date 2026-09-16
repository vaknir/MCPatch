import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PackManifestValidationError,
  parsePackManifest,
  validatePackManifest,
} from "../src/index.js";

const valid = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../fixtures/v1/valid/bundled-demo.json", import.meta.url),
    ),
    "utf8",
  ),
) as Record<string, unknown>;

describe("Pack Manifest v1 runtime validation", () => {
  it.each([
    [
      "unsupported manifest",
      { manifestVersion: 2 },
      "UNSUPPORTED_VERSION",
      "manifestVersion",
    ],
    [
      "wildcard origin",
      origin("https://*.example.com"),
      "INVALID_ORIGIN",
      "matches[0].origin",
    ],
    [
      "unsafe path",
      path("/items/../admin"),
      "INVALID_PATH",
      "matches[0].paths[0].path",
    ],
    [
      "risk mismatch",
      permission("sensitive", ["READ"]),
      "INVALID_PERMISSION",
      "tools[0].risk",
    ],
    ["malformed version", { version: "01.0.0" }, "INVALID_VERSION", "version"],
    [
      "malformed digest",
      { digest: "sha256:NOT-A-DIGEST" },
      "INVALID_DIGEST",
      "digest",
    ],
    [
      "unknown field",
      { remoteScript: "private-marker" },
      "UNKNOWN_FIELD",
      "$.remoteScript",
    ],
  ] as const)("rejects %s", (_name, change, code, field) => {
    const candidate = structuredClone(valid);
    apply(candidate, change);
    expect(validatePackManifest(candidate)).toEqual({ code, field });
  });

  it("rejects duplicate tools and fixtures that reference undeclared tools", () => {
    const duplicate = structuredClone(valid);
    duplicate.tools = [
      ...(duplicate.tools as unknown[]),
      structuredClone((duplicate.tools as unknown[])[0]),
    ];
    expect(validatePackManifest(duplicate)).toEqual({
      code: "DUPLICATE_VALUE",
      field: "tools[1].name",
    });

    const undeclared = structuredClone(valid);
    first(undeclared.fixtures as Array<{ tool: string }>).tool =
      "mcpatch.demo.missing";
    expect(validatePackManifest(undeclared)).toEqual({
      code: "INVALID_REFERENCE",
      field: "fixtures[0].tool",
    });
  });

  it("rejects inverted compatibility ranges", () => {
    const candidate = structuredClone(valid);
    candidate.compatibility = {
      runtime: { minimum: "0.2.0", maximumExclusive: "0.1.0" },
      bridgeProtocol: { minimum: 2, maximum: 1 },
    };
    expect(validatePackManifest(candidate)).toEqual({
      code: "INVALID_COMPATIBILITY",
      field: "compatibility.runtime",
    });
  });

  it("accepts bounded exact HTTPS methods paired with matching tool risks", () => {
    const candidate = structuredClone(valid);
    candidate.networkPolicy = {
      extensionRequests: {
        origins: ["https://search.example.com"],
        methods: ["GET"],
      },
    };
    const tool = first(candidate.tools as Array<Record<string, unknown>>);
    tool.permissions = ["READ", "EXTERNAL_NETWORK"];

    expect(validatePackManifest(candidate)).toBeUndefined();
    expect(parsePackManifest(candidate).networkPolicy).toEqual(
      candidate.networkPolicy,
    );

    const action = structuredClone(valid);
    action.networkPolicy = {
      extensionRequests: {
        origins: ["https://actions.example.com"],
        methods: ["POST"],
      },
    };
    const actionTool = first(action.tools as Array<Record<string, unknown>>);
    actionTool.risk = "action";
    actionTool.permissions = ["ACTION", "EXTERNAL_NETWORK"];
    expect(validatePackManifest(action)).toBeUndefined();

    for (const requests of [
      { origins: ["https://*.example.com"], methods: ["GET"] },
      { origins: ["https://search.example.com"], methods: ["POST", "GET"] },
      { origins: ["https://search.example.com"], methods: ["PUT"] },
      { origins: [], methods: ["GET"] },
    ]) {
      const malformed = structuredClone(candidate);
      malformed.networkPolicy = { extensionRequests: requests };
      expect(validatePackManifest(malformed)).toBeDefined();
    }
  });

  it("rejects undeclared or unused external-network authority", () => {
    const externalTool = structuredClone(valid);
    first(externalTool.tools as Array<Record<string, unknown>>).permissions = [
      "READ",
      "EXTERNAL_NETWORK",
    ];
    expect(validatePackManifest(externalTool)).toEqual({
      code: "INVALID_PERMISSION",
      field: "networkPolicy.extensionRequests",
    });

    const unusedPolicy = structuredClone(valid);
    unusedPolicy.networkPolicy = {
      extensionRequests: {
        origins: ["https://search.example.com"],
        methods: ["GET"],
      },
    };
    expect(validatePackManifest(unusedPolicy)).toEqual({
      code: "INVALID_PERMISSION",
      field: "networkPolicy.extensionRequests",
    });

    const mismatchedMethod = structuredClone(valid);
    first(
      mismatchedMethod.tools as Array<Record<string, unknown>>,
    ).permissions = ["READ", "EXTERNAL_NETWORK"];
    mismatchedMethod.networkPolicy = {
      extensionRequests: {
        origins: ["https://actions.example.com"],
        methods: ["POST"],
      },
    };
    expect(validatePackManifest(mismatchedMethod)).toEqual({
      code: "INVALID_PERMISSION",
      field: "networkPolicy.extensionRequests",
    });

    const mixedAuthority = structuredClone(actionManifest());
    first(mixedAuthority.tools as Array<Record<string, unknown>>).permissions =
      ["ACTION", "EXTERNAL_NETWORK", "READ"];
    expect(validatePackManifest(mixedAuthority)).toEqual({
      code: "INVALID_PERMISSION",
      field: "networkPolicy.extensionRequests",
    });
  });

  it("returns payload-free failures", () => {
    const candidate = structuredClone(valid);
    candidate.remoteScript = "private-marker";
    try {
      parsePackManifest(candidate);
      expect.unreachable("invalid manifest must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PackManifestValidationError);
      expect(String(error)).not.toContain("private-marker");
    }
  });

  it("returns an immutable snapshot detached from the untrusted input", async () => {
    const candidate = structuredClone(valid);
    const manifest = parsePackManifest(candidate);
    candidate.version = "9.9.9";

    expect(manifest.version).toBe("0.1.0");
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.tools)).toBe(true);
    expect(Object.isFrozen(first(manifest.tools).inputSchema)).toBe(true);
    await expect(async () => {
      (manifest as { version: string }).version = "2.0.0";
    }).rejects.toThrow(TypeError);
  });

  it("bounds total content and JSON depth before semantic validation", () => {
    const oversized = structuredClone(valid);
    oversized.description = "x".repeat(1024 * 1024);
    expect(validatePackManifest(oversized)).toEqual({
      code: "LIMIT_EXCEEDED",
      field: "$",
    });

    const tooDeep = structuredClone(valid);
    let nested = first(tooDeep.tools as Array<Record<string, unknown>>)
      .outputSchema as Record<string, unknown>;
    for (let index = 0; index < 40; index += 1) {
      const child: Record<string, unknown> = {};
      nested.child = child;
      nested = child;
    }
    expect(validatePackManifest(tooDeep)?.code).toBe("LIMIT_EXCEEDED");
  });
});

function apply(
  target: Record<string, unknown>,
  change: Record<string, unknown>,
): void {
  if ("origin" in change) {
    first(target.matches as Array<Record<string, unknown>>).origin =
      change.origin;
  } else if ("path" in change) {
    const match = first(target.matches as Array<Record<string, unknown>>);
    first(match.paths as Array<Record<string, unknown>>).path = change.path;
  } else if ("risk" in change) {
    const tool = first(target.tools as Array<Record<string, unknown>>);
    tool.risk = change.risk;
    tool.permissions = change.permissions;
  } else {
    Object.assign(target, change);
  }
}

function actionManifest(): Record<string, unknown> {
  const candidate = structuredClone(valid);
  candidate.networkPolicy = {
    extensionRequests: {
      origins: ["https://actions.example.com"],
      methods: ["POST"],
    },
  };
  const tool = first(candidate.tools as Array<Record<string, unknown>>);
  tool.risk = "action";
  tool.permissions = ["ACTION", "EXTERNAL_NETWORK"];
  return candidate;
}

function origin(value: string): Record<string, unknown> {
  return { origin: value };
}

function path(value: string): Record<string, unknown> {
  return { path: value };
}

function permission(
  risk: string,
  permissions: string[],
): Record<string, unknown> {
  return { risk, permissions };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error("Expected a non-empty test fixture array");
  }
  return value;
}
