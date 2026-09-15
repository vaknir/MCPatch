import { packMatchesLocation, canonicalizePageLocation } from "./location.js";
import type {
  CapabilityResolutionIssue,
  ContextCapabilityResolutionInput,
  ContextCapabilityResolutionResult,
  EnabledPackCandidate,
  NativeCapabilityCandidate,
  PackIdentity,
} from "./resolution-types.js";
import {
  resolutionBucket,
  selectCapabilities,
  type ResolutionBucket,
} from "./resolution-selection.js";
import type { PackManifest } from "./types.js";
import {
  PackManifestValidationError,
  parsePackManifest,
} from "./validation/manifest.js";
import { isRecord } from "./validation/primitives.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const MAX_NATIVE_CAPABILITIES = 256;
const MAX_ENABLED_PACKS = 64;
const MAX_CANDIDATES = 1_024;
const MAX_RESOLVED_CAPABILITIES = 256;

/** Resolves one immutable, context-bound capability snapshot without browser APIs. */
export function resolveContextCapabilities<TNative, TPack>(
  input: ContextCapabilityResolutionInput<TNative, TPack>,
): ContextCapabilityResolutionResult<TNative, TPack> {
  const contextIssue = validateContext(input);
  if (contextIssue !== undefined) return failure(contextIssue);
  const page = canonicalizePageLocation(input.url);
  if (!page.ok) return page;
  if (
    !Array.isArray(input.native) ||
    input.native.length > MAX_NATIVE_CAPABILITIES
  ) {
    return failure({ code: "LIMIT_EXCEEDED", field: "native" });
  }
  if (!Array.isArray(input.packs) || input.packs.length > MAX_ENABLED_PACKS) {
    return failure({ code: "LIMIT_EXCEEDED", field: "packs" });
  }

  const buckets = new Map<string, ResolutionBucket<TNative, TPack>>();
  for (const [index, candidate] of input.native.entries()) {
    const record = candidateObject(candidate, ["name", "value"]);
    if (record === undefined) {
      return failure({
        code: "INVALID_NATIVE_CAPABILITY",
        field: `native[${index}]`,
      });
    }
    if (!validToolName(record.name)) {
      return failure({
        code: "INVALID_NATIVE_CAPABILITY",
        field: `native[${index}].name`,
      });
    }
    const nativeCandidate: NativeCapabilityCandidate<TNative> = {
      name: record.name,
      value: record.value as TNative,
    };
    resolutionBucket(buckets, nativeCandidate.name).native.push(
      nativeCandidate,
    );
  }

  let candidateCount = input.native.length;
  for (const [index, candidate] of input.packs.entries()) {
    const record = candidateObject(candidate, ["manifest", "value"]);
    if (record === undefined) {
      return failure({ code: "INVALID_PACK", field: `packs[${index}]` });
    }
    const packCandidate = record as unknown as EnabledPackCandidate<TPack>;
    const snapshot = snapshotManifest(packCandidate.manifest, index);
    if (!snapshot.ok) return snapshot;
    if (!packMatchesLocation(snapshot.manifest, page.location)) continue;

    const identity = packIdentity(snapshot.manifest);
    candidateCount += snapshot.manifest.tools.length;
    if (candidateCount > MAX_CANDIDATES) {
      return failure({ code: "LIMIT_EXCEEDED", field: "capabilities" });
    }
    for (const tool of snapshot.manifest.tools) {
      resolutionBucket(buckets, tool.name).packs.push({
        identity,
        tool,
        value: packCandidate.value,
      });
    }
  }

  const binding = Object.freeze({
    contextId: input.contextId,
    contextRevision: input.contextRevision,
    origin: page.location.origin,
  });
  const { capabilities, collisions } = selectCapabilities(buckets, binding);
  if (capabilities.length > MAX_RESOLVED_CAPABILITIES) {
    return failure({ code: "LIMIT_EXCEEDED", field: "capabilities" });
  }

  return Object.freeze({
    ok: true,
    resolution: Object.freeze({
      binding,
      capabilities: Object.freeze(capabilities),
      collisions: Object.freeze(collisions),
    }),
  });
}

function validateContext<TNative, TPack>(
  input: ContextCapabilityResolutionInput<TNative, TPack>,
): CapabilityResolutionIssue | undefined {
  if (
    typeof input.contextId !== "string" ||
    input.contextId.length === 0 ||
    input.contextId.length > 128 ||
    !IDENTIFIER.test(input.contextId)
  ) {
    return { code: "INVALID_CONTEXT", field: "contextId" };
  }
  if (
    !Number.isSafeInteger(input.contextRevision) ||
    input.contextRevision < 1
  ) {
    return { code: "INVALID_CONTEXT", field: "contextRevision" };
  }
  return undefined;
}

function snapshotManifest(
  value: unknown,
  index: number,
):
  | { readonly ok: true; readonly manifest: PackManifest }
  | { readonly ok: false; readonly issue: CapabilityResolutionIssue } {
  try {
    return { ok: true, manifest: parsePackManifest(value) };
  } catch (error) {
    const field =
      error instanceof PackManifestValidationError
        ? manifestField(index, error.issue.field)
        : `packs[${index}].manifest`;
    return failure({ code: "INVALID_PACK", field });
  }
}

function packIdentity(manifest: PackManifest): PackIdentity {
  return Object.freeze({
    publisher: manifest.publisher,
    id: manifest.id,
    version: manifest.version,
    digest: manifest.digest,
  });
}

function validToolName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 128 &&
    TOOL_NAME.test(value)
  );
}

function candidateObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    return undefined;
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
  }
  return value;
}

function manifestField(index: number, field: string): string {
  const prefix = `packs[${index}].manifest`;
  if (field === "$") return prefix;
  return field.startsWith("$.")
    ? `${prefix}.${field.slice(2)}`
    : `${prefix}.${field}`;
}

function failure(issue: CapabilityResolutionIssue): {
  readonly ok: false;
  readonly issue: CapabilityResolutionIssue;
} {
  return Object.freeze({ ok: false, issue: Object.freeze(issue) });
}
