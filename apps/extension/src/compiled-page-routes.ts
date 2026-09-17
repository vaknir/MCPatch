import type {
  PackManifest,
  PackToolHandler,
  ResolvedCapability,
} from "@mcpatch/sdk/runtime";

import type { PageRuntimeTool } from "./compiled-pack-model.js";
import type { ValidatedRuntimePack } from "./compiled-pack-validation.js";

const MAX_PAGE_TOOLS = 128;
const TOOL_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export interface RuntimePackProjection {
  readonly candidates: readonly {
    readonly manifest: PackManifest;
    readonly value: ValidatedRuntimePack;
  }[];
  readonly pageHandlers?: ReadonlyMap<string, PackToolHandler>;
}

/** Limits page-context pack manifests to tools reported over the page channel. */
export function projectRuntimePacks(
  packs: readonly ValidatedRuntimePack[],
  page: readonly PageRuntimeTool[] | undefined,
): RuntimePackProjection | undefined {
  if (page === undefined) {
    return Object.freeze({
      candidates: Object.freeze(
        packs
          .filter((value) => value.kind === "compiled")
          .map((value) => ({ manifest: value.manifest, value })),
      ),
    });
  }
  const pageHandlers = validatePageHandlers(page);
  if (pageHandlers === undefined) return undefined;
  const candidates: Array<{
    readonly manifest: PackManifest;
    readonly value: ValidatedRuntimePack;
  }> = [];
  for (const value of packs) {
    const tools = value.manifest.tools.filter((tool) =>
      pageHandlers.has(tool.name),
    );
    if (tools.length === 0) continue;
    const names = new Set(tools.map((tool) => tool.name));
    candidates.push(
      Object.freeze({
        manifest: Object.freeze({
          ...value.manifest,
          tools: Object.freeze(tools),
          fixtures: Object.freeze(
            value.manifest.fixtures.filter((fixture) =>
              names.has(fixture.tool),
            ),
          ),
        }),
        value,
      }),
    );
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    pageHandlers,
  });
}

/** Ensures every reported page route belongs to a pack matching this page. */
export function pageProjectionMatchesResolution(
  projection: RuntimePackProjection,
  capabilities: readonly ResolvedCapability<unknown, ValidatedRuntimePack>[],
  collisions: readonly {
    readonly name: string;
    readonly packs: readonly unknown[];
  }[],
): boolean {
  if (projection.pageHandlers === undefined) return true;
  const matchingPackNames = new Set(
    capabilities
      .filter((capability) => capability.source === "pack")
      .map((capability) => capability.name),
  );
  for (const collision of collisions) {
    if (collision.packs.length > 0) matchingPackNames.add(collision.name);
  }
  return [...projection.pageHandlers.keys()].every((name) =>
    matchingPackNames.has(name),
  );
}

function validatePageHandlers(
  tools: readonly PageRuntimeTool[],
): ReadonlyMap<string, PackToolHandler> | undefined {
  if (!Array.isArray(tools) || tools.length > MAX_PAGE_TOOLS) return undefined;
  const handlers = new Map<string, PackToolHandler>();
  for (const candidate of tools) {
    if (!isDataRecord(candidate)) return undefined;
    const keys = Reflect.ownKeys(candidate);
    if (
      keys.length !== 2 ||
      !keys.includes("name") ||
      !keys.includes("execute") ||
      typeof candidate.name !== "string" ||
      candidate.name.length > 128 ||
      !TOOL_NAME.test(candidate.name) ||
      typeof candidate.execute !== "function" ||
      handlers.has(candidate.name)
    ) {
      return undefined;
    }
    handlers.set(candidate.name, candidate.execute as PackToolHandler);
  }
  return Object.freeze(handlers);
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}
