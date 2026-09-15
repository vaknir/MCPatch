import {
  encodeBoundedJsonFrame,
  parseBoundedJsonFrame,
} from "./page-channel-json.js";
import {
  validatePageToWorkerMessage,
  validateWorkerToPageMessage,
} from "./page-channel-messages.js";
import {
  invalidType,
  invalidValue,
  isRecord,
  wrongDirection,
} from "./page-channel-primitives.js";
import {
  PAGE_PROTOCOL_VERSION,
  PageProtocolValidationError,
  type PageToWorkerMessage,
  type WorkerToPageMessage,
} from "./page-channel-types.js";

const PAGE_TO_WORKER_TYPES = new Set([
  "page_capability_snapshot",
  "page_context_closed",
  "page_hello",
  "page_tool_error",
  "page_tool_result",
]);
const WORKER_TO_PAGE_TYPES = new Set([
  "page_cancel",
  "page_hello_ack",
  "page_tool_call",
]);

export function parsePageToWorkerFrame(frame: unknown): PageToWorkerMessage {
  const message = pageMessage(frame, "page");
  validatePageToWorkerMessage(message);
  return message as unknown as PageToWorkerMessage;
}

export function parseWorkerToPageFrame(frame: unknown): WorkerToPageMessage {
  const message = pageMessage(frame, "worker");
  validateWorkerToPageMessage(message);
  return message as unknown as WorkerToPageMessage;
}

export function encodePageToWorkerMessage(
  message: PageToWorkerMessage,
): string {
  const frame = encodeBoundedJsonFrame(message);
  parsePageToWorkerFrame(frame);
  return frame;
}

export function encodeWorkerToPageMessage(
  message: WorkerToPageMessage,
): string {
  const frame = encodeBoundedJsonFrame(message);
  parseWorkerToPageFrame(frame);
  return frame;
}

function pageMessage(
  frame: unknown,
  direction: "page" | "worker",
): Record<string, unknown> {
  const value = parseBoundedJsonFrame(frame);
  if (!isRecord(value)) invalidType("$");
  if (value.pageProtocolVersion !== PAGE_PROTOCOL_VERSION) {
    throw new PageProtocolValidationError(
      "UNSUPPORTED_VERSION",
      "pageProtocolVersion",
    );
  }
  if (typeof value.type !== "string") invalidType("type");
  const sameDirection =
    direction === "page"
      ? PAGE_TO_WORKER_TYPES.has(value.type)
      : WORKER_TO_PAGE_TYPES.has(value.type);
  const oppositeDirection =
    direction === "page"
      ? WORKER_TO_PAGE_TYPES.has(value.type)
      : PAGE_TO_WORKER_TYPES.has(value.type);
  if (oppositeDirection) wrongDirection("type");
  if (!sameDirection) invalidValue("type");
  return value;
}
