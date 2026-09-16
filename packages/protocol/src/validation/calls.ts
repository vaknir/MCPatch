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
const IMAGE_MIME_TYPES = new Set(["image/png", "image/webp"]);
const MAX_IMAGE_DIMENSION = 2_048;
const MAX_IMAGE_BYTES = 160 * 1_024;
const MAX_IMAGE_BASE64_CHARACTERS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

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
    ["content"],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateTypeAndRoute(message, "tool_result") ??
    validateJsonValue(message.result, "result") ??
    (Object.hasOwn(message, "content")
      ? validateToolContent(message.content)
      : undefined)
  );
}

export function validateToolContent(
  value: unknown,
): ValidationIssue | undefined {
  if (!Array.isArray(value) || value.length !== 1) {
    return issue("LIMIT_EXCEEDED", "content");
  }
  const checked = checkClosedObject(
    value[0],
    ["type", "mimeType", "data", "width", "height"],
    [],
    "content[0]",
  );
  if (checked.issue !== undefined) return checked.issue;
  const image = checked.value as JsonRecord;
  return (
    (image.type === "image"
      ? undefined
      : issue("INVALID_VALUE", "content[0].type")) ??
    (typeof image.mimeType === "string" && IMAGE_MIME_TYPES.has(image.mimeType)
      ? undefined
      : issue("INVALID_VALUE", "content[0].mimeType")) ??
    validateImageDimension(image.width, "content[0].width") ??
    validateImageDimension(image.height, "content[0].height") ??
    validateBase64Image(image.data)
  );
}

function validateImageDimension(
  value: unknown,
  field: string,
): ValidationIssue | undefined {
  return Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_IMAGE_DIMENSION
    ? undefined
    : issue("LIMIT_EXCEEDED", field);
}

function validateBase64Image(value: unknown): ValidationIssue | undefined {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length > MAX_IMAGE_BASE64_CHARACTERS ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    return issue("INVALID_VALUE", "content[0].data");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = (value.length / 4) * 3 - padding;
  return bytes <= MAX_IMAGE_BYTES
    ? undefined
    : issue("LIMIT_EXCEEDED", "content[0].data");
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
