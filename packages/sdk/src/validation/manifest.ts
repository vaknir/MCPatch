import {
  PACK_MANIFEST_VERSION,
  type PackManifest,
  type PackManifestValidationIssue,
} from "../types.js";
import { validateCompatibility, validateExecution } from "./compatibility.js";
import { validateMatches, validateNetworkPolicy } from "./matching.js";
import {
  boundedPattern,
  boundedText,
  cloneAndFreeze,
  closedObject,
  validPattern,
  validateJsonBounds,
} from "./primitives.js";
import { validateFixtures, validateTools } from "./tools.js";

const PUBLISHER = /^[a-z][a-z0-9]*$/;
const PACK_ID = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const TOP_LEVEL_FIELDS = [
  "manifestVersion",
  "publisher",
  "id",
  "name",
  "description",
  "version",
  "digest",
  "compatibility",
  "execution",
  "matches",
  "networkPolicy",
  "tools",
  "fixtures",
] as const;

export class PackManifestValidationError extends Error {
  readonly issue: PackManifestValidationIssue;

  constructor(issue: PackManifestValidationIssue) {
    super(`Pack manifest rejected: ${issue.code} at ${issue.field}`);
    this.name = "PackManifestValidationError";
    this.issue = issue;
  }
}

export function parsePackManifest(value: unknown): PackManifest {
  const validationIssue = validatePackManifest(value);
  if (validationIssue !== undefined) {
    throw new PackManifestValidationError(validationIssue);
  }
  return cloneAndFreeze(value) as PackManifest;
}

export function validatePackManifest(
  value: unknown,
): PackManifestValidationIssue | undefined {
  const boundIssue = validateJsonBounds(value);
  if (boundIssue !== undefined) return boundIssue;
  const checked = closedObject(value, TOP_LEVEL_FIELDS, [], "$");
  if (checked.issue !== undefined) return checked.issue;
  const manifest = checked.value;

  if (manifest.manifestVersion !== PACK_MANIFEST_VERSION) {
    return { code: "UNSUPPORTED_VERSION", field: "manifestVersion" };
  }
  const identityIssue =
    boundedPattern(manifest.publisher, 3, 64, PUBLISHER, "publisher") ??
    boundedPattern(manifest.id, 3, 64, PACK_ID, "id") ??
    boundedText(manifest.name, 1, 128, "name") ??
    boundedText(manifest.description, 1, 1024, "description") ??
    validPattern(manifest.version, SEMVER, "INVALID_VERSION", "version", 64) ??
    validPattern(manifest.digest, DIGEST, "INVALID_DIGEST", "digest", 71);
  if (identityIssue !== undefined) return identityIssue;

  const compatibilityIssue = validateCompatibility(manifest.compatibility);
  if (compatibilityIssue !== undefined) return compatibilityIssue;
  const executionIssue = validateExecution(manifest.execution);
  if (executionIssue !== undefined) return executionIssue;
  const matchIssue = validateMatches(manifest.matches);
  if (matchIssue !== undefined) return matchIssue;
  const networkIssue = validateNetworkPolicy(manifest.networkPolicy);
  if (networkIssue !== undefined) return networkIssue;

  const tools = validateTools(manifest.tools, manifest.publisher as string);
  if ("issue" in tools) return tools.issue;
  const externalTools = (manifest.tools as readonly unknown[]).some(
    (tool) =>
      typeof tool === "object" &&
      tool !== null &&
      Array.isArray((tool as { permissions?: unknown }).permissions) &&
      (tool as { permissions: unknown[] }).permissions.includes(
        "EXTERNAL_NETWORK",
      ),
  );
  if (
    externalTools !==
    (typeof manifest.networkPolicy === "object" &&
      manifest.networkPolicy !== null &&
      (manifest.networkPolicy as { extensionRequests?: unknown })
        .extensionRequests !== "none")
  ) {
    return {
      code: "INVALID_PERMISSION",
      field: "networkPolicy.extensionRequests",
    };
  }
  return validateFixtures(manifest.fixtures, tools.names);
}
