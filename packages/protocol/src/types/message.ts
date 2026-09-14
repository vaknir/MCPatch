import type { ApprovalRequired, ApprovalResult } from "./approvals.js";
import type { CapabilitySnapshot, ContextClosed } from "./capabilities.js";
import type { Cancel, ToolCall, ToolError, ToolResult } from "./calls.js";
import type { Hello, HelloAck } from "./handshake.js";
import type { ConnectionError, Heartbeat } from "./lifecycle.js";

export type Message =
  | Hello
  | HelloAck
  | CapabilitySnapshot
  | ContextClosed
  | ToolCall
  | ToolResult
  | ToolError
  | Cancel
  | ApprovalRequired
  | ApprovalResult
  | Heartbeat
  | ConnectionError;
