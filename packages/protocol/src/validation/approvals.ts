import type { ValidationIssue } from "./error.js";
import { validateTimestamp } from "./formats.js";
import { validateJsonObject } from "./json.js";
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
/**
 * The requester label is rendered as text in the trusted prompt: short,
 * printable ASCII with no leading or trailing space, so it can neither hide
 * a line break nor imitate the prompt's own chrome.
 */
const MAX_REQUESTER_CLIENT_CHARS = 64;
const DISPLAY_LABEL_PATTERN = /^[!-~](?:[ -~]*[!-~])?$/;

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
      "args",
      "argsHash",
      "expiresAt",
      "requester",
    ],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateTypeAndRoute(message, "approval_required") ??
    validateIdentifier(message.approvalId, "approvalId") ??
    validateToolName(message.tool, "tool") ??
    validateJsonObject(message.args, "args") ??
    (typeof message.argsHash === "string" && HASH_PATTERN.test(message.argsHash)
      ? undefined
      : issue("INVALID_VALUE", "argsHash")) ??
    validateTimestamp(message.expiresAt, "expiresAt") ??
    validateRequester(message.requester)
  );
}

function validateRequester(value: unknown): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    ["client", "session"],
    [],
    "requester",
  );
  if (checked.issue !== undefined) return checked.issue;
  const requester = checked.value as JsonRecord;
  return (
    (isDisplayLabel(requester.client)
      ? undefined
      : issue("INVALID_VALUE", "requester.client")) ??
    validateIdentifier(requester.session, "requester.session")
  );
}

function isDisplayLabel(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length <= MAX_REQUESTER_CLIENT_CHARS &&
    DISPLAY_LABEL_PATTERN.test(value)
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
