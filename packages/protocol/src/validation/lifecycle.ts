import type { ValidationIssue } from "./error.js";
import { validateErrorCode } from "./calls.js";
import { validateTimestamp } from "./formats.js";
import {
  checkClosedObject,
  issue,
  type JsonRecord,
  validateBoundedText,
  validateIdentifier,
  validateProtocolVersion,
} from "./primitives.js";

export function validateHeartbeat(value: unknown): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    ["protocolVersion", "type", "heartbeatId", "sentAt"],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === "heartbeat"
      ? undefined
      : issue("INVALID_VALUE", "type")) ??
    validateIdentifier(message.heartbeatId, "heartbeatId") ??
    validateTimestamp(message.sentAt, "sentAt")
  );
}

export function validateConnectionError(
  value: unknown,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    ["protocolVersion", "type", "code", "message", "fatal"],
    [],
  );
  if (checked.issue !== undefined) return checked.issue;
  const message = checked.value as JsonRecord;
  return (
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === "connection_error"
      ? undefined
      : issue("INVALID_VALUE", "type")) ??
    validateErrorCode(message.code, "code") ??
    validateBoundedText(message.message, 1, 512, "message") ??
    (typeof message.fatal === "boolean"
      ? undefined
      : issue("INVALID_TYPE", "fatal"))
  );
}
