import type { ErrorCode, VersionedMessage } from "./common.js";

export interface Heartbeat extends VersionedMessage {
  type: "heartbeat";
  heartbeatId: string;
  sentAt: string;
}

export interface ConnectionError extends VersionedMessage {
  type: "connection_error";
  code: ErrorCode;
  message: string;
  fatal: boolean;
}
