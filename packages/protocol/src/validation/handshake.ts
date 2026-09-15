import type { ValidationIssue } from "./error.js";
import {
  checkClosedObject,
  issue,
  type JsonRecord,
  validateIdentifier,
  validateImplementation,
  validatePositiveSafeInteger,
  validateProtocolVersion,
} from "./primitives.js";

export function validateHello(value: unknown): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    [
      "protocolVersion",
      "type",
      "role",
      "supportedProtocolVersions",
      "implementation",
    ],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;

  const basicIssue =
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === "hello" ? undefined : issue("INVALID_VALUE", "type")) ??
    (message.role === "bridge" || message.role === "extension"
      ? undefined
      : issue("INVALID_VALUE", "role")) ??
    validateImplementation(message.implementation);
  if (basicIssue !== undefined) return basicIssue;

  return validateSupportedProtocolVersions(message.supportedProtocolVersions);
}

export function validateHelloAck(value: unknown): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    [
      "protocolVersion",
      "type",
      "supportedProtocolVersions",
      "selectedProtocolVersion",
      "connectionId",
      "implementation",
    ],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  const basicIssue =
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === "hello_ack"
      ? undefined
      : issue("INVALID_VALUE", "type")) ??
    validatePositiveSafeInteger(
      message.selectedProtocolVersion,
      "selectedProtocolVersion",
      2_147_483_647,
    ) ??
    validateIdentifier(message.connectionId, "connectionId") ??
    validateImplementation(message.implementation);
  return (
    basicIssue ??
    validateSupportedProtocolVersions(message.supportedProtocolVersions)
  );
}

function validateSupportedProtocolVersions(
  versions: unknown,
): ValidationIssue | undefined {
  if (!Array.isArray(versions)) {
    return issue("INVALID_TYPE", "supportedProtocolVersions");
  }
  if (versions.length < 1 || versions.length > 16) {
    return issue("LIMIT_EXCEEDED", "supportedProtocolVersions");
  }
  if (
    versions.some(
      (version) =>
        validatePositiveSafeInteger(
          version,
          "supportedProtocolVersions",
          2_147_483_647,
        ) !== undefined,
    ) ||
    new Set(versions).size !== versions.length
  ) {
    return issue("INVALID_VALUE", "supportedProtocolVersions");
  }
  return undefined;
}
