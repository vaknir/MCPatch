import { NATIVE_TOOL_NAMESPACE } from "../types/capabilities.js";
import type { ValidationIssue } from "./error.js";
import { validateOrigin, validateSemVer } from "./formats.js";
import { validateRuntimeSchema } from "./json.js";
import {
  checkClosedObject,
  issue,
  type JsonRecord,
  validateBoundedText,
  validateIdentifier,
  validatePositiveSafeInteger,
  validateProtocolVersion,
  validateToolName,
} from "./primitives.js";

const PERMISSIONS = new Set([
  "READ",
  "ACTION",
  "SENSITIVE",
  "CREDENTIAL",
  "EXTERNAL_NETWORK",
  "ARBITRARY_EXECUTION",
]);
const PUBLISHER_PATTERN = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
const PACK_ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function validateCapabilitySnapshot(
  value: unknown,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    [
      "protocolVersion",
      "type",
      "contextId",
      "contextRevision",
      "origin",
      "capabilities",
    ],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;

  const headerIssue =
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === "capability_snapshot"
      ? undefined
      : issue("INVALID_VALUE", "type")) ??
    validateIdentifier(message.contextId, "contextId") ??
    validatePositiveSafeInteger(message.contextRevision, "contextRevision") ??
    validateOrigin(message.origin, "origin");
  if (headerIssue !== undefined) return headerIssue;

  if (!Array.isArray(message.capabilities)) {
    return issue("INVALID_TYPE", "capabilities");
  }
  if (message.capabilities.length > 256) {
    return issue("LIMIT_EXCEEDED", "capabilities");
  }

  const names = new Set<string>();
  for (const [index, capability] of message.capabilities.entries()) {
    const prefix = `capabilities[${index}]`;
    const capabilityIssue = validateCapability(
      capability,
      message.origin as string,
      prefix,
    );
    if (capabilityIssue !== undefined) return capabilityIssue;

    const name = (capability as JsonRecord).name as string;
    if (names.has(name)) {
      return issue("INVALID_CAPABILITY", `${prefix}.name`);
    }
    names.add(name);
  }

  return undefined;
}

function validateCapability(
  value: unknown,
  contextOrigin: string,
  prefix: string,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    [
      "name",
      "description",
      "origin",
      "source",
      "risk",
      "permissions",
      "inputSchema",
    ],
    ["title", "pack", "outputSchema"],
    prefix,
  );
  if (checked.issue !== undefined) return checked.issue;
  const capability = checked.value as JsonRecord;

  const basicIssue =
    validateToolName(capability.name, `${prefix}.name`) ??
    validateBoundedText(
      capability.description,
      1,
      1024,
      `${prefix}.description`,
    ) ??
    validateOrigin(capability.origin, `${prefix}.origin`);
  if (basicIssue !== undefined) return basicIssue;
  if (capability.origin !== contextOrigin) {
    return issue("INVALID_CAPABILITY", `${prefix}.origin`);
  }
  if (Object.hasOwn(capability, "title")) {
    const titleIssue = validateBoundedText(
      capability.title,
      1,
      128,
      `${prefix}.title`,
    );
    if (titleIssue !== undefined) return titleIssue;
  }

  const sourceIssue =
    validateSource(capability, prefix) ??
    validateSourceNamespace(capability, prefix);
  if (sourceIssue !== undefined) return sourceIssue;

  const permissionIssue = validatePermissions(capability, prefix);
  if (permissionIssue !== undefined) return permissionIssue;

  const inputIssue = validateRuntimeSchema(
    capability.inputSchema,
    `${prefix}.inputSchema`,
    true,
  );
  if (inputIssue !== undefined) return inputIssue;
  if (Object.hasOwn(capability, "outputSchema")) {
    const outputIssue = validateRuntimeSchema(
      capability.outputSchema,
      `${prefix}.outputSchema`,
    );
    if (outputIssue !== undefined) return outputIssue;
  }

  return undefined;
}

function validateSource(
  capability: JsonRecord,
  prefix: string,
): ValidationIssue | undefined {
  if (capability.source === "pack") {
    if (!Object.hasOwn(capability, "pack")) {
      return issue("INVALID_CAPABILITY", `${prefix}.pack`);
    }
    // A pack result crosses to the MCP client only through its declared
    // output schema, so a pack capability without one has no allowlist.
    if (!Object.hasOwn(capability, "outputSchema")) {
      return issue("INVALID_CAPABILITY", `${prefix}.outputSchema`);
    }
    return validatePack(capability.pack, `${prefix}.pack`);
  }
  if (capability.source === "native_webmcp") {
    return Object.hasOwn(capability, "pack")
      ? issue("INVALID_CAPABILITY", `${prefix}.pack`)
      : undefined;
  }
  return issue("INVALID_VALUE", `${prefix}.source`);
}

/**
 * Tool names carry their provenance: a page-declared tool lives under the
 * reserved native namespace and a reviewed pack tool never does, so neither
 * can be published under the other's name.
 */
function validateSourceNamespace(
  capability: JsonRecord,
  prefix: string,
): ValidationIssue | undefined {
  const namespaced =
    typeof capability.name === "string" &&
    capability.name.startsWith(`${NATIVE_TOOL_NAMESPACE}.`);
  return namespaced === (capability.source === "native_webmcp")
    ? undefined
    : issue("INVALID_CAPABILITY", `${prefix}.name`);
}

function validatePack(
  value: unknown,
  prefix: string,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    ["publisher", "id", "version", "digest"],
    [],
    prefix,
  );
  if (checked.issue !== undefined) return checked.issue;
  const pack = checked.value as JsonRecord;

  if (
    typeof pack.publisher !== "string" ||
    pack.publisher.length < 3 ||
    pack.publisher.length > 128 ||
    !PUBLISHER_PATTERN.test(pack.publisher)
  ) {
    return issue("INVALID_VALUE", `${prefix}.publisher`);
  }
  if (
    typeof pack.id !== "string" ||
    pack.id.length < 3 ||
    pack.id.length > 64 ||
    !PACK_ID_PATTERN.test(pack.id)
  ) {
    return issue("INVALID_VALUE", `${prefix}.id`);
  }

  return (
    validateSemVer(pack.version, `${prefix}.version`) ??
    (typeof pack.digest === "string" && DIGEST_PATTERN.test(pack.digest)
      ? undefined
      : issue("INVALID_VALUE", `${prefix}.digest`))
  );
}

function validatePermissions(
  capability: JsonRecord,
  prefix: string,
): ValidationIssue | undefined {
  if (!Array.isArray(capability.permissions)) {
    return issue("INVALID_TYPE", `${prefix}.permissions`);
  }
  if (capability.permissions.length < 1 || capability.permissions.length > 6) {
    return issue("LIMIT_EXCEEDED", `${prefix}.permissions`);
  }
  if (
    capability.permissions.some(
      (permission) =>
        typeof permission !== "string" || !PERMISSIONS.has(permission),
    ) ||
    new Set(capability.permissions).size !== capability.permissions.length
  ) {
    return issue("INVALID_CAPABILITY", `${prefix}.permissions`);
  }

  const requiredPermission =
    capability.risk === "read"
      ? "READ"
      : capability.risk === "action"
        ? "ACTION"
        : capability.risk === "sensitive"
          ? "SENSITIVE"
          : undefined;
  if (
    requiredPermission === undefined ||
    !capability.permissions.includes(requiredPermission)
  ) {
    return issue("INVALID_CAPABILITY", `${prefix}.risk`);
  }

  return undefined;
}
