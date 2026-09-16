import type { JsonObject, RoutedMessage, VersionedMessage } from "./common.js";

/** Which MCP client is asking. Display-only; never used for policy. */
export interface ApprovalRequester {
  client: string;
  session: string;
}

export interface ApprovalRequired extends RoutedMessage {
  type: "approval_required";
  approvalId: string;
  tool: string;
  /** The bridge-validated arguments the hash binds, shown to the human. */
  args: JsonObject;
  argsHash: string;
  expiresAt: string;
  requester: ApprovalRequester;
}

export type ApprovalDecision = "approved" | "denied";

export interface ApprovalResult extends VersionedMessage {
  type: "approval_result";
  approvalId: string;
  requestId: string;
  decision: ApprovalDecision;
}
