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
  const externalIssue = validateExternalNetworkPairing(manifest);
  if (externalIssue !== undefined) return externalIssue;
  return validateFixtures(manifest.fixtures, tools.names);
}

function validateExternalNetworkPairing(
  manifest: Record<string, unknown>,
): PackManifestValidationIssue | undefined {
  const tools = manifest.tools as ReadonlyArray<{
    readonly risk?: unknown;
    readonly permissions?: unknown;
  }>;
  let read = false;
  let action = false;
  for (const tool of tools) {
    if (
      !Array.isArray(tool.permissions) ||
      !tool.permissions.includes("EXTERNAL_NETWORK")
    ) {
      continue;
    }
    if (
      tool.risk === "read" &&
      tool.permissions.length === 2 &&
      tool.permissions.includes("READ")
    ) {
      read = true;
    } else if (
      tool.risk === "action" &&
      tool.permissions.length === 2 &&
      tool.permissions.includes("ACTION")
    ) {
      action = true;
    } else {
      return {
        code: "INVALID_PERMISSION",
        field: "networkPolicy.extensionRequests",
      };
    }
  }
  const requests = (
    manifest.networkPolicy as { readonly extensionRequests?: unknown }
  ).extensionRequests;
  if (requests === "none") {
    return read || action
      ? { code: "INVALID_PERMISSION", field: "networkPolicy.extensionRequests" }
      : undefined;
  }
  if (typeof requests !== "object" || requests === null) {
    return {
      code: "INVALID_PERMISSION",
      field: "networkPolicy.extensionRequests",
    };
  }
  const methods = (requests as { readonly methods?: unknown }).methods;
  if (!Array.isArray(methods)) {
    return {
      code: "INVALID_PERMISSION",
      field: "networkPolicy.extensionRequests",
    };
  }
  return methods.includes("GET") === read && methods.includes("POST") === action
    ? undefined
    : { code: "INVALID_PERMISSION", field: "networkPolicy.extensionRequests" };
}
