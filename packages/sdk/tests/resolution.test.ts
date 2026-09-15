import { describe, expect, it } from "vitest";

import { resolveContextCapabilities, type PackManifest } from "../src/index.js";
import { identity, pack } from "./support/pack.js";

describe("native-first capability resolution", () => {
  it("selects native over matching packs and reports the collision", () => {
    const searchPack = pack({ id: "search", tools: ["acme.search"] });
    const result = resolved({
      native: [{ name: "acme.search", value: "native-handler" }],
      packs: [{ manifest: searchPack, value: "pack-handler" }],
    });

    expect(result.capabilities).toEqual([
      {
        binding: binding(),
        name: "acme.search",
        source: "native_webmcp",
        value: "native-handler",
      },
    ]);
    expect(result.collisions).toEqual([
      {
        name: "acme.search",
        nativeCount: 1,
        outcome: "native",
        packs: [identity(searchPack)],
        reason: "native_precedence",
      },
    ]);
  });

  it("hides pack collisions and is independent of pack arrival order", () => {
    const alpha = pack({
      id: "alpha",
      digestCharacter: "a",
      tools: ["acme.alpha", "acme.shared"],
    });
    const beta = pack({
      id: "beta",
      digestCharacter: "b",
      tools: ["acme.beta", "acme.shared"],
    });

    const forward = resolved({
      packs: [
        { manifest: alpha, value: "alpha-handler" },
        { manifest: beta, value: "beta-handler" },
      ],
    });
    const reverse = resolved({
      packs: [
        { manifest: beta, value: "beta-handler" },
        { manifest: alpha, value: "alpha-handler" },
      ],
    });

    expect(project(forward)).toEqual(project(reverse));
    expect(forward.capabilities.map(({ name }) => name)).toEqual([
      "acme.alpha",
      "acme.beta",
    ]);
    expect(forward.collisions).toEqual([
      {
        name: "acme.shared",
        nativeCount: 0,
        outcome: "hidden",
        packs: [identity(alpha), identity(beta)],
        reason: "ambiguous_pack",
      },
    ]);
  });

  it("hides duplicate native names instead of falling back to a pack", () => {
    const fallback = pack({ id: "fallback", tools: ["acme.search"] });
    const result = resolved({
      native: [
        { name: "acme.search", value: "native-a" },
        { name: "acme.search", value: "native-b" },
      ],
      packs: [{ manifest: fallback, value: "pack-handler" }],
    });

    expect(result.capabilities).toEqual([]);
    expect(result.collisions).toEqual([
      {
        name: "acme.search",
        nativeCount: 2,
        outcome: "hidden",
        packs: [identity(fallback)],
        reason: "ambiguous_native",
      },
    ]);
  });

  it("binds each fresh navigation result to its exact revision and origin", () => {
    const searchPack = pack({ id: "search", tools: ["acme.search"] });
    const first = resolved({
      contextRevision: 7,
      url: "https://example.com/items/first",
      packs: [{ manifest: searchPack, value: "pack-handler" }],
    });
    const navigated = resolved({
      contextRevision: 8,
      url: "https://example.com/outside",
      packs: [{ manifest: searchPack, value: "pack-handler" }],
    });

    expect(first.binding).toEqual({
      contextId: "tab-1",
      contextRevision: 7,
      origin: "https://example.com",
    });
    expect(first.capabilities[0]?.binding).toBe(first.binding);
    expect(navigated.binding.contextRevision).toBe(8);
    expect(navigated.capabilities).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.binding)).toBe(true);
    expect(Object.isFrozen(first.capabilities)).toBe(true);
  });

  it("snapshots manifest metadata and bounds candidate collections", () => {
    const mutable = structuredClone(
      pack({ id: "snapshot", tools: ["acme.snapshot"] }),
    );
    const result = resolveContextCapabilities({
      contextId: "tab-1",
      contextRevision: 1,
      url: "https://example.com/items/one",
      native: [],
      packs: [{ manifest: mutable, value: "pack-handler" }],
    });
    if (!result.ok) throw new Error("Expected a valid resolution");
    const capability = result.resolution.capabilities[0];
    if (capability?.source !== "pack") {
      throw new Error("Expected a resolved pack capability");
    }
    const mutableTool = mutable.tools[0];
    if (mutableTool === undefined)
      throw new Error("Expected one manifest tool");
    (mutableTool as { name: string }).name = "acme.changed";
    expect(capability.tool.name).toBe("acme.snapshot");
    expect(Object.isFrozen(capability.tool)).toBe(true);
    expect(Object.isFrozen(capability.pack)).toBe(true);

    expect(
      resolveContextCapabilities({
        contextId: "tab-1",
        contextRevision: 1,
        url: "https://example.com/items/one",
        native: Array.from({ length: 257 }, (_, index) => ({
          name: `acme.native_${String(index)}`,
          value: index,
        })),
        packs: [],
      }),
    ).toEqual({
      ok: false,
      issue: { code: "LIMIT_EXCEEDED", field: "native" },
    });
  });

  it("fails closed on malformed context, native, and pack inputs", () => {
    expect(
      resolveContextCapabilities({
        contextId: "tab 1",
        contextRevision: 1,
        url: "https://example.com/items/one",
        native: [],
        packs: [],
      }),
    ).toEqual({
      ok: false,
      issue: { code: "INVALID_CONTEXT", field: "contextId" },
    });

    expect(
      resolveContextCapabilities({
        contextId: "tab-1",
        contextRevision: 1,
        url: "https://example.com/items/one",
        native: [{ name: "not namespaced", value: undefined }],
        packs: [],
      }),
    ).toEqual({
      ok: false,
      issue: { code: "INVALID_NATIVE_CAPABILITY", field: "native[0].name" },
    });

    let accessed = false;
    const accessor = {
      name: "acme.accessor",
      get value() {
        accessed = true;
        return "handler";
      },
    };
    expect(
      resolveContextCapabilities({
        contextId: "tab-1",
        contextRevision: 1,
        url: "https://example.com/items/one",
        native: [accessor],
        packs: [],
      }),
    ).toEqual({
      ok: false,
      issue: { code: "INVALID_NATIVE_CAPABILITY", field: "native[0]" },
    });
    expect(accessed).toBe(false);

    const invalid = {
      ...pack({ id: "invalid", tools: ["acme.invalid"] }),
      matches: [{ origin: "https://*.example.com", paths: [] }],
    } as PackManifest;
    expect(
      resolveContextCapabilities({
        contextId: "tab-1",
        contextRevision: 1,
        url: "https://example.com/items/one",
        native: [],
        packs: [{ manifest: invalid, value: undefined }],
      }),
    ).toEqual({
      ok: false,
      issue: {
        code: "INVALID_PACK",
        field: "packs[0].manifest.matches[0].origin",
      },
    });
  });
});

function resolved({
  contextRevision = 3,
  url = "https://example.com/items/one?ignored=true",
  native = [],
  packs = [],
}: {
  contextRevision?: number;
  url?: string;
  native?: readonly { name: string; value: string }[];
  packs?: readonly { manifest: PackManifest; value: string }[];
}) {
  const result = resolveContextCapabilities({
    contextId: "tab-1",
    contextRevision,
    url,
    native,
    packs,
  });
  if (!result.ok) throw new Error(`Unexpected issue: ${result.issue.code}`);
  return result.resolution;
}

function binding() {
  return {
    contextId: "tab-1",
    contextRevision: 3,
    origin: "https://example.com",
  };
}

function project(resolution: ReturnType<typeof resolved>) {
  return {
    capabilities: resolution.capabilities.map(({ name, source }) => ({
      name,
      source,
    })),
    collisions: resolution.collisions,
  };
}
