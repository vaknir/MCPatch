import { validateCapabilities } from "./page-channel-capabilities.js";
import {
  BINDING_FIELDS,
  exact,
  identifier,
  invalidType,
  invalidValue,
  isRecord,
  positiveInteger,
  toolName,
  validateBinding,
  validateImplementation,
  wrongDirection,
} from "./page-channel-primitives.js";
import {
  MAX_PAGE_CAPABILITIES,
  PAGE_PROTOCOL_VERSION,
  PageProtocolValidationError,
} from "./page-channel-types.js";

export function validatePageToWorkerMessage(
  message: Record<string, unknown>,
): void {
  switch (message.type) {
    case "page_hello":
      validateHello(message);
      return;
    case "page_capability_snapshot":
      validateSnapshot(message);
      return;
    case "page_tool_result":
      validateResult(message);
      return;
    case "page_tool_error":
      validateError(message);
      return;
    case "page_context_closed":
      validateClosed(message);
      return;
    default:
      wrongDirection("type");
  }
}

export function validateWorkerToPageMessage(
  message: Record<string, unknown>,
): void {
  switch (message.type) {
    case "page_hello_ack":
      validateHelloAck(message);
      return;
    case "page_tool_call":
      validateCall(message);
      return;
    case "page_cancel":
      validateCancel(message);
      return;
    default:
      wrongDirection("type");
  }
}

function validateHello(message: Record<string, unknown>): void {
  exact(message, [
    "pageProtocolVersion",
    "type",
    "supportedPageProtocolVersions",
    "implementation",
  ]);
  const supported = message.supportedPageProtocolVersions;
  if (
    !Array.isArray(supported) ||
    supported.length !== 1 ||
    supported[0] !== PAGE_PROTOCOL_VERSION
  ) {
    invalidValue("supportedPageProtocolVersions");
  }
  validateImplementation(message.implementation);
}

function validateHelloAck(message: Record<string, unknown>): void {
  exact(message, [
    "pageProtocolVersion",
    "type",
    "selectedPageProtocolVersion",
    "implementation",
    "authorizedPackTools",
    ...BINDING_FIELDS,
  ]);
  if (message.selectedPageProtocolVersion !== PAGE_PROTOCOL_VERSION) {
    throw new PageProtocolValidationError(
      "UNSUPPORTED_VERSION",
      "selectedPageProtocolVersion",
    );
  }
  validateImplementation(message.implementation);
  validateAuthorizedPackTools(message.authorizedPackTools);
  validateBinding(message);
}

function validateAuthorizedPackTools(value: unknown): void {
  if (!Array.isArray(value)) invalidType("authorizedPackTools");
  if (value.length > MAX_PAGE_CAPABILITIES) {
    throw new PageProtocolValidationError(
      "LIMIT_EXCEEDED",
      "authorizedPackTools",
    );
  }
  let previous: string | undefined;
  for (const [index, valueTool] of value.entries()) {
    toolName(valueTool, `authorizedPackTools[${index}]`);
    if (previous !== undefined && previous >= valueTool) {
      invalidValue(`authorizedPackTools[${index}]`);
    }
    previous = valueTool;
  }
}

function validateSnapshot(message: Record<string, unknown>): void {
  exact(message, [
    "pageProtocolVersion",
    "type",
    ...BINDING_FIELDS,
    "snapshotRevision",
    "capabilities",
  ]);
  validateBinding(message);
  positiveInteger(message.snapshotRevision, "snapshotRevision");
  validateCapabilities(message.capabilities);
}

function validateCall(message: Record<string, unknown>): void {
  exact(message, [
    "pageProtocolVersion",
    "type",
    ...BINDING_FIELDS,
    "requestId",
    "tool",
    "args",
  ]);
  validateBoundRequest(message);
  if (!isRecord(message.args)) invalidType("args");
}

function validateResult(message: Record<string, unknown>): void {
  exact(message, [
    "pageProtocolVersion",
    "type",
    ...BINDING_FIELDS,
    "requestId",
    "tool",
    "result",
  ]);
  validateBoundRequest(message);
}

function validateError(message: Record<string, unknown>): void {
  exact(message, [
    "pageProtocolVersion",
    "type",
    ...BINDING_FIELDS,
    "requestId",
    "tool",
    "code",
  ]);
  validateBoundRequest(message);
  if (
    typeof message.code !== "string" ||
    ![
      "CANCELLED",
      "EXECUTION_FAILED",
      "RESULT_INVALID",
      "TOOL_UNAVAILABLE",
    ].includes(message.code)
  ) {
    invalidValue("code");
  }
}

function validateCancel(message: Record<string, unknown>): void {
  exact(message, [
    "pageProtocolVersion",
    "type",
    ...BINDING_FIELDS,
    "requestId",
    "tool",
  ]);
  validateBoundRequest(message);
}

function validateClosed(message: Record<string, unknown>): void {
  exact(message, ["pageProtocolVersion", "type", ...BINDING_FIELDS, "reason"]);
  validateBinding(message);
  if (
    message.reason !== "adapter_unavailable" &&
    message.reason !== "document_unloading"
  ) {
    invalidValue("reason");
  }
}

function validateBoundRequest(message: Record<string, unknown>): void {
  validateBinding(message);
  identifier(message.requestId, "requestId");
  toolName(message.tool, "tool");
}
