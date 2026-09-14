import type { Message } from "../types/index.js";
import {
  validateApprovalRequired,
  validateApprovalResult,
} from "./approvals.js";
import { validateCapabilitySnapshot } from "./capabilities.js";
import {
  validateCancel,
  validateToolCall,
  validateToolError,
  validateToolResult,
} from "./calls.js";
import { validateContextClosed } from "./context.js";
import { ProtocolValidationError, type ValidationIssue } from "./error.js";
import { validateHello, validateHelloAck } from "./handshake.js";
import { validateConnectionError, validateHeartbeat } from "./lifecycle.js";
import { isRecord, issue } from "./primitives.js";

const MESSAGE_TYPES = new Set([
  "hello",
  "hello_ack",
  "capability_snapshot",
  "context_closed",
  "tool_call",
  "tool_result",
  "tool_error",
  "cancel",
  "approval_required",
  "approval_result",
  "heartbeat",
  "connection_error",
]);

export function validateMessage(value: unknown): value is Message {
  return validationIssue(value) === undefined;
}

export function parseMessage(value: unknown): Message {
  const foundIssue = validationIssue(value);
  if (foundIssue !== undefined) throw new ProtocolValidationError(foundIssue);
  return value as Message;
}

export function validationIssue(value: unknown): ValidationIssue | undefined {
  try {
    return validateMessageValue(value);
  } catch {
    return issue("INVALID_VALUE", "$");
  }
}

function validateMessageValue(value: unknown): ValidationIssue | undefined {
  if (!isRecord(value)) return issue("INVALID_TYPE", "$");
  if (typeof value.type !== "string" || !MESSAGE_TYPES.has(value.type)) {
    return issue("INVALID_VALUE", "type");
  }

  switch (value.type) {
    case "hello":
      return validateHello(value);
    case "hello_ack":
      return validateHelloAck(value);
    case "capability_snapshot":
      return validateCapabilitySnapshot(value);
    case "context_closed":
      return validateContextClosed(value);
    case "tool_call":
      return validateToolCall(value);
    case "tool_result":
      return validateToolResult(value);
    case "tool_error":
      return validateToolError(value);
    case "cancel":
      return validateCancel(value);
    case "approval_required":
      return validateApprovalRequired(value);
    case "approval_result":
      return validateApprovalResult(value);
    case "heartbeat":
      return validateHeartbeat(value);
    case "connection_error":
      return validateConnectionError(value);
    default:
      return issue("INVALID_VALUE", "type");
  }
}
