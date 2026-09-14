import type { ValidationIssue } from "./error.js";
import { validateJsonObject, validateJsonValue } from "./json.js";
import {
  checkClosedObject,
  issue,
  type JsonRecord,
  validateBoundedText,
  validateIdentifier,
  validateProtocolVersion,
  validateToolName,
} from "./primitives.js";
import { validateTypeAndRoute } from "./routing.js";

const ERROR_CODES = new Set([
  "INVALID_REQUEST",
  "UNSUPPORTED_VERSION",
  "INVALID_STATE",
  "UNAUTHORIZED",
  "CAPABILITY_DENIED",
  "ORIGIN_MISMATCH",
  "CONTEXT_NOT_FOUND",
  "TOOL_NOT_FOUND",
  "APPROVAL_REQUIRED",
  "APPROVAL_DENIED",
  "CANCELLED",
  "TIMEOUT",
  "EXECUTION_FAILED",
  "RESULT_INVALID",
  "INTERNAL_ERROR",
]);

export function validateToolCall(value: unknown): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    [
      "protocolVersion",
      "type",
      "requestId",
      "contextId",
      "contextRevision",
      "origin",
      "tool",
      "args",
    ],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateTypeAndRoute(message, "tool_call") ??
    validateToolName(message.tool, "tool") ??
    validateJsonObject(message.args, "args")
  );
}

export function validateToolResult(
  value: unknown,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    [
      "protocolVersion",
      "type",
      "requestId",
      "contextId",
      "contextRevision",
      "origin",
      "result",
    ],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateTypeAndRoute(message, "tool_result") ??
    validateJsonValue(message.result, "result")
  );
}

export function validateToolError(value: unknown): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    [
      "protocolVersion",
      "type",
      "requestId",
      "contextId",
      "contextRevision",
      "origin",
      "code",
      "message",
      "retryable",
    ],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateTypeAndRoute(message, "tool_error") ??
    validateErrorCode(message.code, "code") ??
    validateBoundedText(message.message, 1, 512, "message") ??
    (typeof message.retryable === "boolean"
      ? undefined
      : issue("INVALID_TYPE", "retryable"))
  );
}

export function validateCancel(value: unknown): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    ["protocolVersion", "type", "requestId"],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === "cancel" ? undefined : issue("INVALID_VALUE", "type")) ??
    validateIdentifier(message.requestId, "requestId")
  );
}

export function validateErrorCode(
  value: unknown,
  field: string,
): ValidationIssue | undefined {
  return typeof value === "string" && ERROR_CODES.has(value)
    ? undefined
    : issue("INVALID_VALUE", field);
}
