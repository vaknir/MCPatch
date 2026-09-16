import type { ApprovalDecision, ApprovalRequired } from "@mcpatch/protocol";

import {
  MCPATCH_APPROVAL_PORT_NAME,
  type ApprovalDecisionMessage,
  type ApprovalPort,
  type ApprovalPresentation,
  type ApprovalReady,
  type ApprovalScheduler,
  type ApprovalSurface,
  type ApprovalWithdrawn,
  type ChromeApprovalRuntimeApi,
  type ChromeApprovalTabsApi,
} from "./approval-model.js";

const MAX_PENDING_APPROVALS = 8;
const MAX_APPROVAL_LIFETIME_MS = 5 * 60 * 1_000;
/**
 * After a denial, further prompts open in the background for this long so a
 * looping caller cannot keep yanking focus; the user pulls the next prompt
 * from the toolbar instead of having it pushed at them.
 */
const RECENT_DENIAL_WINDOW_MS = 60 * 1_000;
/**
 * When the MCP client gives up while a prompt is on screen, the prompt stays
 * visible this long with an explanation instead of vanishing under the
 * user's cursor. The decision surface is already gone by then.
 */
const WITHDRAWN_GRACE_MS = 8 * 1_000;

interface PendingApproval {
  readonly message: ApprovalRequired;
  readonly resolve: (decision: ApprovalDecision) => void;
  readonly url: string;
  presented: boolean;
  timer: unknown;
  candidate?: PendingPortCandidate;
  port?: ApprovalPort;
  tabId?: number;
}

interface PendingPortCandidate {
  readonly port: ApprovalPort;
  readonly messages: unknown[];
}

const browserScheduler: ApprovalScheduler = {
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  now() {
    return new Date();
  },
  schedule(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
};

export class ApprovalController implements ApprovalSurface {
  readonly #runtime: ChromeApprovalRuntimeApi;
  readonly #tabs: ChromeApprovalTabsApi;
  readonly #scheduler: ApprovalScheduler;
  readonly #pendingByApproval = new Map<string, PendingApproval>();
  readonly #approvalByRequest = new Map<string, string>();
  readonly #approvalByTab = new Map<number, string>();
  #lastDenialAt: number | undefined;

  constructor(
    runtime: ChromeApprovalRuntimeApi,
    tabs: ChromeApprovalTabsApi,
    scheduler: ApprovalScheduler = browserScheduler,
  ) {
    this.#runtime = runtime;
    this.#tabs = tabs;
    this.#scheduler = scheduler;
    runtime.onConnect.addListener((port) => this.#connected(port));
    tabs.onRemoved.addListener((tabId) => this.#tabRemoved(tabId));
  }

  request(
    message: ApprovalRequired,
    resolve: (decision: ApprovalDecision) => void,
  ): boolean {
    const now = this.#scheduler.now().getTime();
    const expiresAt = Date.parse(message.expiresAt);
    if (
      this.#pendingByApproval.size >= MAX_PENDING_APPROVALS ||
      this.#pendingByApproval.has(message.approvalId) ||
      this.#approvalByRequest.has(message.requestId) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      expiresAt - now > MAX_APPROVAL_LIFETIME_MS
    ) {
      return false;
    }

    const url = this.#approvalUrl(message.approvalId);
    const pending: PendingApproval = {
      message,
      presented: false,
      resolve,
      url,
      timer: undefined,
    };
    pending.timer = this.#scheduler.schedule(
      () => this.#finish(message.approvalId, "denied"),
      expiresAt - now,
    );
    this.#pendingByApproval.set(message.approvalId, pending);
    this.#approvalByRequest.set(message.requestId, message.approvalId);
    const active =
      this.#lastDenialAt === undefined ||
      now - this.#lastDenialAt >= RECENT_DENIAL_WINDOW_MS;
    try {
      void this.#tabs.create({ active, url }).then(
        (tab) => this.#tabCreated(message.approvalId, pending, tab.id),
        () => this.#finish(message.approvalId, "denied"),
      );
    } catch {
      this.#discard(message.approvalId);
      return false;
    }
    return true;
  }

  cancel(requestId: string): boolean {
    const approvalId = this.#approvalByRequest.get(requestId);
    if (approvalId === undefined) return false;
    const pending = this.#take(approvalId);
    if (pending === undefined) return false;
    if (pending.presented && pending.port !== undefined) {
      this.#withdraw(pending, pending.port);
    } else {
      this.#cleanUp(pending);
    }
    return true;
  }

  closeAll(): void {
    for (const approvalId of [...this.#pendingByApproval.keys()]) {
      this.#discard(approvalId);
    }
  }

  #approvalUrl(approvalId: string): string {
    const url = new URL(this.#runtime.getURL("approval.html"));
    url.searchParams.set("approvalId", approvalId);
    return url.href;
  }

  #tabCreated(
    approvalId: string,
    pending: PendingApproval,
    tabId: number | undefined,
  ): void {
    if (
      this.#pendingByApproval.get(approvalId) !== pending ||
      tabId === undefined ||
      !Number.isSafeInteger(tabId) ||
      tabId < 0
    ) {
      if (tabId !== undefined) this.#removeTab(tabId);
      if (this.#pendingByApproval.get(approvalId) === pending) {
        this.#finish(approvalId, "denied");
      }
      return;
    }
    pending.tabId = tabId;
    this.#approvalByTab.set(tabId, approvalId);
    const candidate = pending.candidate;
    if (candidate === undefined) return;
    delete pending.candidate;
    if (candidate.port.sender?.tab?.id !== tabId) {
      disconnectQuietly(candidate.port);
      this.#finish(approvalId, "denied");
      return;
    }
    pending.port = candidate.port;
    candidate.port.onMessage.addListener((value) =>
      this.#receive(pending, candidate.port, value),
    );
    for (const message of candidate.messages) {
      this.#receive(pending, candidate.port, message);
    }
  }

  #connected(port: ApprovalPort): void {
    if (port.name !== MCPATCH_APPROVAL_PORT_NAME) return;
    const approvalId = this.#approvalIdFromUrl(port.sender?.url);
    const pending =
      approvalId === undefined
        ? undefined
        : this.#pendingByApproval.get(approvalId);
    if (
      pending === undefined ||
      pending.port !== undefined ||
      pending.candidate !== undefined ||
      port.sender?.id !== this.#runtime.id ||
      port.sender.frameId !== 0 ||
      port.sender.url !== pending.url ||
      typeof port.sender.tab?.id !== "number" ||
      (pending.tabId !== undefined && port.sender.tab.id !== pending.tabId)
    ) {
      disconnectQuietly(port);
      return;
    }
    if (pending.tabId === undefined) {
      const candidate: PendingPortCandidate = { port, messages: [] };
      pending.candidate = candidate;
      port.onMessage.addListener((value) => {
        if (
          this.#pendingByApproval.get(pending.message.approvalId) !== pending ||
          pending.candidate !== candidate
        ) {
          return;
        }
        if (candidate.messages.length > 0) {
          this.#finish(pending.message.approvalId, "denied");
          return;
        }
        candidate.messages.push(value);
      });
    } else {
      pending.port = port;
      port.onMessage.addListener((value) =>
        this.#receive(pending, port, value),
      );
    }
    port.onDisconnect.addListener(() => {
      if (this.#pendingByApproval.get(pending.message.approvalId) === pending) {
        this.#finish(pending.message.approvalId, "denied");
      }
    });
  }

  #receive(pending: PendingApproval, port: ApprovalPort, value: unknown): void {
    if (
      this.#pendingByApproval.get(pending.message.approvalId) !== pending ||
      pending.port !== port
    ) {
      return;
    }
    const ready = parseApprovalReady(value);
    if (ready !== undefined) {
      if (
        pending.presented ||
        ready.approvalId !== pending.message.approvalId
      ) {
        this.#finish(pending.message.approvalId, "denied");
        return;
      }
      const presentation: ApprovalPresentation = {
        type: "approval_present",
        approvalId: pending.message.approvalId,
        tool: pending.message.tool,
        origin: pending.message.origin,
        args: pending.message.args,
        argsHash: pending.message.argsHash,
        expiresAt: pending.message.expiresAt,
        requester: pending.message.requester,
      };
      try {
        port.postMessage(presentation);
        pending.presented = true;
      } catch {
        this.#finish(pending.message.approvalId, "denied");
      }
      return;
    }
    const decision = parseApprovalDecision(value);
    if (
      decision === undefined ||
      !pending.presented ||
      decision.approvalId !== pending.message.approvalId
    ) {
      this.#finish(pending.message.approvalId, "denied");
      return;
    }
    this.#finish(pending.message.approvalId, decision.decision);
  }

  #approvalIdFromUrl(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    try {
      const url = new URL(value);
      const approvalPage = new URL(this.#runtime.getURL("approval.html"));
      if (
        url.protocol !== approvalPage.protocol ||
        url.host !== approvalPage.host ||
        url.pathname !== approvalPage.pathname
      ) {
        return undefined;
      }
      return url.searchParams.get("approvalId") ?? undefined;
    } catch {
      return undefined;
    }
  }

  #tabRemoved(tabId: number): void {
    const approvalId = this.#approvalByTab.get(tabId);
    if (approvalId !== undefined) this.#finish(approvalId, "denied");
  }

  #finish(approvalId: string, decision: ApprovalDecision): void {
    const pending = this.#take(approvalId);
    if (pending === undefined) return;
    if (decision === "denied") {
      this.#lastDenialAt = this.#scheduler.now().getTime();
    }
    try {
      pending.resolve(decision);
    } finally {
      this.#cleanUp(pending);
    }
  }

  #discard(approvalId: string): void {
    const pending = this.#take(approvalId);
    if (pending !== undefined) this.#cleanUp(pending);
  }

  /**
   * The record is already removed, so a late decision has nowhere to land.
   * Tell the page why it is closing, drop the channel, and remove the tab
   * after a short grace period.
   */
  #withdraw(pending: PendingApproval, port: ApprovalPort): void {
    const notice: ApprovalWithdrawn = {
      type: "approval_withdrawn",
      approvalId: pending.message.approvalId,
    };
    try {
      port.postMessage(notice);
    } catch {
      // The page already went away; closing the tab below is enough.
    }
    disconnectQuietly(pending.candidate?.port);
    disconnectQuietly(port);
    const tabId = pending.tabId;
    if (tabId === undefined) return;
    this.#scheduler.schedule(() => this.#removeTab(tabId), WITHDRAWN_GRACE_MS);
  }

  #take(approvalId: string): PendingApproval | undefined {
    const pending = this.#pendingByApproval.get(approvalId);
    if (pending === undefined) return undefined;
    this.#pendingByApproval.delete(approvalId);
    this.#approvalByRequest.delete(pending.message.requestId);
    if (pending.tabId !== undefined) this.#approvalByTab.delete(pending.tabId);
    this.#scheduler.cancel(pending.timer);
    return pending;
  }

  #cleanUp(pending: PendingApproval): void {
    disconnectQuietly(pending.candidate?.port);
    disconnectQuietly(pending.port);
    if (pending.tabId !== undefined) this.#removeTab(pending.tabId);
  }

  #removeTab(tabId: number): void {
    void this.#tabs.remove(tabId).catch(() => undefined);
  }
}

function parseApprovalReady(value: unknown): ApprovalReady | undefined {
  if (!isClosedObject(value, ["type", "approvalId"])) return undefined;
  return value.type === "approval_ready" && typeof value.approvalId === "string"
    ? (value as unknown as ApprovalReady)
    : undefined;
}

function parseApprovalDecision(
  value: unknown,
): ApprovalDecisionMessage | undefined {
  if (!isClosedObject(value, ["type", "approvalId", "decision"])) {
    return undefined;
  }
  return value.type === "approval_decision" &&
    typeof value.approvalId === "string" &&
    (value.decision === "approved" || value.decision === "denied")
    ? (value as unknown as ApprovalDecisionMessage)
    : undefined;
}

function isClosedObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function disconnectQuietly(port: ApprovalPort | undefined): void {
  try {
    port?.disconnect();
  } catch {
    // The approval channel is already closed.
  }
}
