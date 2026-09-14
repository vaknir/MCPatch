import type {
  ErrorCode,
  JsonObject,
  JsonValue,
  RoutedMessage,
  VersionedMessage,
} from "./common.js";

export interface ToolCall extends RoutedMessage {
  type: "tool_call";
  tool: string;
  args: JsonObject;
}

export interface ToolResult extends RoutedMessage {
  type: "tool_result";
  result: JsonValue;
}

export interface ToolError extends RoutedMessage {
  type: "tool_error";
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface Cancel extends VersionedMessage {
  type: "cancel";
  requestId: string;
}
