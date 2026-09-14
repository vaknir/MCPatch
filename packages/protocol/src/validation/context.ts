import type { ValidationIssue } from "./error.js";
import {
  checkClosedObject,
  issue,
  type JsonRecord,
  validateIdentifier,
  validatePositiveSafeInteger,
  validateProtocolVersion,
} from "./primitives.js";

const CONTEXT_CLOSED_REASONS = new Set([
  "navigation",
  "tab_closed",
  "pack_disabled",
  "disconnected",
]);

export function validateContextClosed(
  value: unknown,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    ["protocolVersion", "type", "contextId", "contextRevision", "reason"],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === "context_closed"
      ? undefined
      : issue("INVALID_VALUE", "type")) ??
    validateIdentifier(message.contextId, "contextId") ??
    validatePositiveSafeInteger(message.contextRevision, "contextRevision") ??
    (typeof message.reason === "string" &&
    CONTEXT_CLOSED_REASONS.has(message.reason)
      ? undefined
      : issue("INVALID_VALUE", "reason"))
  );
}
