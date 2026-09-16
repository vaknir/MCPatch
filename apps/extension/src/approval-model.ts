import type {
  ApprovalDecision,
  ApprovalRequester,
  ApprovalRequired,
  JsonObject,
} from "@mcpatch/protocol";

import type { ChromeEvent } from "./lifecycle.js";

export const MCPATCH_APPROVAL_PORT_NAME = "mcpatch.approval.v1";

export interface ApprovalMessageSender {
  readonly frameId?: number;
  readonly id?: string;
  readonly tab?: { readonly id?: number };
  readonly url?: string;
}

export interface ApprovalPort {
  readonly name: string;
  readonly onDisconnect: ChromeEvent<[]>;
  readonly onMessage: ChromeEvent<[unknown]>;
  readonly sender?: ApprovalMessageSender;
  disconnect(): void;
  postMessage(message: unknown): void;
}

export interface ChromeApprovalRuntimeApi {
  readonly id: string;
  readonly onConnect: ChromeEvent<[ApprovalPort]>;
  connect?(connectInfo: { readonly name: string }): ApprovalPort;
  getURL(path: string): string;
}

export interface ApprovalTab {
  readonly id?: number;
}

export interface ChromeApprovalTabsApi {
  readonly onRemoved: ChromeEvent<[number]>;
  create(properties: {
    readonly active: boolean;
    readonly url: string;
  }): Promise<ApprovalTab>;
  remove(tabId: number): Promise<void>;
}

export interface ApprovalScheduler {
  cancel(handle: unknown): void;
  now(): Date;
  schedule(callback: () => void, delayMs: number): unknown;
}

export interface ApprovalSurface {
  request(
    message: ApprovalRequired,
    resolve: (decision: ApprovalDecision) => void,
  ): boolean;
  cancel(requestId: string): boolean;
  closeAll(): void;
}

export interface ApprovalReady {
  readonly type: "approval_ready";
  readonly approvalId: string;
}

export interface ApprovalDecisionMessage {
  readonly type: "approval_decision";
  readonly approvalId: string;
  readonly decision: ApprovalDecision;
}

/**
 * Sent to a presented prompt when the requesting MCP client stopped waiting.
 * The pending record is already discarded, so no decision can follow; the
 * page only explains why the prompt is closing.
 */
export interface ApprovalWithdrawn {
  readonly type: "approval_withdrawn";
  readonly approvalId: string;
}

/**
 * Everything the trusted page renders. `args` are the bridge-validated,
 * bridge-retained arguments the hash commits to, so the user approves what
 * will run rather than an opaque digest; `requester` names the MCP client and
 * bridge session that asked, so a user running several agents can tell which
 * one is asking.
 */
export interface ApprovalPresentation {
  readonly type: "approval_present";
  readonly approvalId: string;
  readonly tool: string;
  readonly origin: string;
  readonly args: JsonObject;
  readonly argsHash: string;
  readonly expiresAt: string;
  readonly requester: ApprovalRequester;
}
