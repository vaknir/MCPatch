import type { ValidationIssue } from "./error.js";
import { validateTimestamp } from "./formats.js";
import {
  checkClosedObject,
  issue,
  type JsonRecord,
  validateIdentifier,
  validateProtocolVersion,
  validateToolName,
} from "./primitives.js";
import { validateTypeAndRoute } from "./routing.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function validateApprovalRequired(
  value: unknown,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    [
      "protocolVersion",
      "type",
      "approvalId",
      "requestId",
      "contextId",
      "contextRevision",
      "origin",
      "tool",
      "argsHash",
      "expiresAt",
    ],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateTypeAndRoute(message, "approval_required") ??
    validateIdentifier(message.approvalId, "approvalId") ??
    validateToolName(message.tool, "tool") ??
    (typeof message.argsHash === "string" && HASH_PATTERN.test(message.argsHash)
      ? undefined
      : issue("INVALID_VALUE", "argsHash")) ??
    validateTimestamp(message.expiresAt, "expiresAt")
  );
}

export function validateApprovalResult(
  value: unknown,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    ["protocolVersion", "type", "approvalId", "requestId", "decision"],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === "approval_result"
      ? undefined
      : issue("INVALID_VALUE", "type")) ??
    validateIdentifier(message.approvalId, "approvalId") ??
    validateIdentifier(message.requestId, "requestId") ??
    (message.decision === "approved" || message.decision === "denied"
      ? undefined
      : issue("INVALID_VALUE", "decision"))
  );
}
