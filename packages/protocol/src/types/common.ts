export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type Role = "bridge" | "extension";

export interface Implementation {
  name: string;
  version: string;
}

export type Permission =
  | "READ"
  | "ACTION"
  | "SENSITIVE"
  | "CREDENTIAL"
  | "EXTERNAL_NETWORK"
  | "ARBITRARY_EXECUTION";

export type Risk = "action" | "read" | "sensitive";

export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_VERSION"
  | "INVALID_STATE"
  | "UNAUTHORIZED"
  | "CAPABILITY_DENIED"
  | "ORIGIN_MISMATCH"
  | "CONTEXT_NOT_FOUND"
  | "TOOL_NOT_FOUND"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_DENIED"
  | "CANCELLED"
  | "TIMEOUT"
  | "EXECUTION_FAILED"
  | "RESULT_INVALID"
  | "INTERNAL_ERROR";

export interface VersionedMessage {
  protocolVersion: ProtocolVersion;
}

export interface RoutedMessage extends VersionedMessage {
  requestId: string;
  contextId: string;
  contextRevision: number;
  origin: string;
}
