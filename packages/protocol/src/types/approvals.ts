import type { RoutedMessage, VersionedMessage } from "./common.js";

export interface ApprovalRequired extends RoutedMessage {
  type: "approval_required";
  approvalId: string;
  tool: string;
  argsHash: string;
  expiresAt: string;
}

export type ApprovalDecision = "approved" | "denied";

export interface ApprovalResult extends VersionedMessage {
  type: "approval_result";
  approvalId: string;
  requestId: string;
  decision: ApprovalDecision;
}
