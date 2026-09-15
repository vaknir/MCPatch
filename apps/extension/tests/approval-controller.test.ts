import {
  PROTOCOL_VERSION,
  type ApprovalDecision,
  type ApprovalRequired,
} from "@mcpatch/protocol";
import { describe, expect, it, vi } from "vitest";

import { ApprovalController } from "../src/approval-controller.js";
import {
  MCPATCH_APPROVAL_PORT_NAME,
  type ApprovalMessageSender,
  type ApprovalPort,
  type ApprovalTab,
  type ChromeApprovalRuntimeApi,
  type ChromeApprovalTabsApi,
} from "../src/approval-model.js";
import { FakeChromeEvent, FakeScheduler } from "./support/native-session.js";

const EXTENSION_ID = "test-extension-id";
const APPROVAL_ID = "approval.0123456789abcdef0123456789abcdef";
const BASE_URL = `chrome-extension://${EXTENSION_ID}/approval.html`;

describe("trusted approval controller", () => {
  it("presents only bridge-bound metadata and resolves an approval once", async () => {
    const state = setup();
    const resolved = vi.fn<(decision: ApprovalDecision) => void>();

    expect(state.controller.request(approvalRequired(), resolved)).toBe(true);
    await flushPromises();
    const port = state.connectApproval();
    port.emitMessage({ type: "approval_ready", approvalId: APPROVAL_ID });

    expect(port.posted).toEqual([
      {
        type: "approval_present",
        approvalId: APPROVAL_ID,
        tool: "demo.action",
        origin: "https://example.com",
        argsHash: "a".repeat(64),
        expiresAt: "2026-09-15T00:01:00Z",
      },
    ]);
    expect(JSON.stringify(port.posted)).not.toContain("request-approval");
    expect(JSON.stringify(port.posted)).not.toContain("contextId");

    port.emitMessage({
      type: "approval_decision",
      approvalId: APPROVAL_ID,
      decision: "approved",
    });
    port.emitMessage({
      type: "approval_decision",
      approvalId: APPROVAL_ID,
      decision: "denied",
    });

    expect(resolved).toHaveBeenCalledOnce();
    expect(resolved).toHaveBeenCalledWith("approved");
    expect(port.disconnected).toBe(true);
    expect(state.tabs.removed).toEqual([17]);
  });

  it("rejects website, wrong-frame, and wrong-tab senders", async () => {
    const state = setup();
    const resolved = vi.fn<(decision: ApprovalDecision) => void>();
    state.controller.request(approvalRequired(), resolved);
    await flushPromises();

    for (const candidateSender of [
      sender({ id: "website-script" }),
      sender({ frameId: 1 }),
      sender({ tab: { id: 18 } }),
      sender({ url: "https://example.com/approval.html" }),
    ]) {
      const port = new FakeApprovalPort(candidateSender);
      state.runtime.onConnect.emit(port);
      expect(port.disconnected).toBe(true);
    }
    expect(resolved).not.toHaveBeenCalled();

    state.tabs.onRemoved.emit(17);
    expect(resolved).toHaveBeenCalledWith("denied");
  });

  it("fails closed for malformed messages, closure, expiry, and open failure", async () => {
    const malformed = setup();
    const malformedResult = vi.fn<(decision: ApprovalDecision) => void>();
    malformed.controller.request(approvalRequired(), malformedResult);
    await flushPromises();
    malformed.connectApproval().emitMessage({
      type: "approval_ready",
      approvalId: APPROVAL_ID,
      extra: true,
    });
    expect(malformedResult).toHaveBeenCalledWith("denied");

    const unpresented = setup();
    const unpresentedResult = vi.fn<(decision: ApprovalDecision) => void>();
    unpresented.controller.request(approvalRequired(), unpresentedResult);
    await flushPromises();
    unpresented.connectApproval().emitMessage({
      type: "approval_decision",
      approvalId: APPROVAL_ID,
      decision: "approved",
    });
    expect(unpresentedResult).toHaveBeenCalledWith("denied");

    const closed = setup();
    const closedResult = vi.fn<(decision: ApprovalDecision) => void>();
    closed.controller.request(approvalRequired(), closedResult);
    await flushPromises();
    closed.connectApproval().emitDisconnect();
    expect(closedResult).toHaveBeenCalledWith("denied");

    const expired = setup();
    const expiredResult = vi.fn<(decision: ApprovalDecision) => void>();
    expired.controller.request(approvalRequired(), expiredResult);
    expired.scheduler.advanceBy(60_000);
    expect(expiredResult).toHaveBeenCalledWith("denied");

    const failed = setup({ createFails: true });
    const failedResult = vi.fn<(decision: ApprovalDecision) => void>();
    failed.controller.request(approvalRequired(), failedResult);
    await flushPromises();
    expect(failedResult).toHaveBeenCalledWith("denied");
  });

  it("discards cancellation and disconnect without authorizing stale prompts", async () => {
    const state = setup();
    const resolved = vi.fn<(decision: ApprovalDecision) => void>();
    state.controller.request(approvalRequired(), resolved);
    await flushPromises();
    const port = state.connectApproval();

    expect(state.controller.cancel("request-approval")).toBe(true);
    expect(state.controller.cancel("request-approval")).toBe(false);
    port.emitMessage({
      type: "approval_decision",
      approvalId: APPROVAL_ID,
      decision: "approved",
    });
    expect(resolved).not.toHaveBeenCalled();

    const disconnected = setup();
    const disconnectedResult = vi.fn<(decision: ApprovalDecision) => void>();
    disconnected.controller.request(approvalRequired(), disconnectedResult);
    await flushPromises();
    disconnected.controller.closeAll();
    expect(disconnectedResult).not.toHaveBeenCalled();
    expect(disconnected.tabs.removed).toEqual([17]);
  });

  it("bounds pending prompts and rejects invalid lifetimes", () => {
    const state = setup();
    const resolved = vi.fn<(decision: ApprovalDecision) => void>();
    expect(
      state.controller.request(
        approvalRequired({ expiresAt: "2026-09-14T23:59:59Z" }),
        resolved,
      ),
    ).toBe(false);
    expect(
      state.controller.request(
        approvalRequired({ expiresAt: "2026-09-15T00:05:01Z" }),
        resolved,
      ),
    ).toBe(false);

    for (let index = 0; index < 8; index += 1) {
      expect(
        state.controller.request(
          approvalRequired({
            approvalId: `approval.${index.toString().padStart(32, "0")}`,
            requestId: `request-${index}`,
          }),
          resolved,
        ),
      ).toBe(true);
    }
    expect(
      state.controller.request(
        approvalRequired({
          approvalId: `approval.${"9".repeat(32)}`,
          requestId: "request-9",
        }),
        resolved,
      ),
    ).toBe(false);
  });

  it("removes a tab created after its request was cancelled", async () => {
    let finishCreate: ((tab: ApprovalTab) => void) | undefined;
    const state = setup({
      create: () =>
        new Promise<ApprovalTab>((resolve) => {
          finishCreate = resolve;
        }),
    });
    const resolved = vi.fn<(decision: ApprovalDecision) => void>();
    state.controller.request(approvalRequired(), resolved);

    state.controller.cancel("request-approval");
    finishCreate?.({ id: 17 });
    await flushPromises();

    expect(resolved).not.toHaveBeenCalled();
    expect(state.tabs.removed).toEqual([17]);
  });

  it("binds an early page connection only after its created tab is known", async () => {
    let finishCreate: ((tab: ApprovalTab) => void) | undefined;
    const state = setup({
      create: () =>
        new Promise<ApprovalTab>((resolve) => {
          finishCreate = resolve;
        }),
    });
    const resolved = vi.fn<(decision: ApprovalDecision) => void>();
    state.controller.request(approvalRequired(), resolved);
    const port = state.connectApproval();
    port.emitMessage({ type: "approval_ready", approvalId: APPROVAL_ID });
    expect(port.posted).toEqual([]);

    finishCreate?.({ id: 17 });
    await flushPromises();

    expect(port.posted).toEqual([
      expect.objectContaining({
        type: "approval_present",
        approvalId: APPROVAL_ID,
      }),
    ]);
    expect(resolved).not.toHaveBeenCalled();
  });
});

function setup(
  options: {
    readonly create?: () => Promise<ApprovalTab>;
    readonly createFails?: boolean;
  } = {},
) {
  const runtime = new FakeApprovalRuntime();
  const tabs = new FakeApprovalTabs(options);
  const scheduler = new FakeScheduler();
  const controller = new ApprovalController(runtime, tabs, scheduler);
  return {
    controller,
    runtime,
    scheduler,
    tabs,
    connectApproval() {
      const port = new FakeApprovalPort(sender());
      runtime.onConnect.emit(port);
      return port;
    },
  };
}

class FakeApprovalRuntime implements ChromeApprovalRuntimeApi {
  readonly id = EXTENSION_ID;
  readonly onConnect = new FakeChromeEvent<[ApprovalPort]>();

  getURL(path: string): string {
    return `chrome-extension://${this.id}/${path.replace(/^\//u, "")}`;
  }
}

class FakeApprovalTabs implements ChromeApprovalTabsApi {
  readonly onRemoved = new FakeChromeEvent<[number]>();
  readonly created: string[] = [];
  readonly removed: number[] = [];
  readonly #options: {
    readonly create?: () => Promise<ApprovalTab>;
    readonly createFails?: boolean;
  };

  constructor(options: {
    readonly create?: () => Promise<ApprovalTab>;
    readonly createFails?: boolean;
  }) {
    this.#options = options;
  }

  create(properties: { readonly active: true; readonly url: string }) {
    this.created.push(properties.url);
    if (this.#options.createFails === true) {
      return Promise.reject(new Error("tab create failed"));
    }
    return this.#options.create?.() ?? Promise.resolve({ id: 17 });
  }

  remove(tabId: number): Promise<void> {
    this.removed.push(tabId);
    return Promise.resolve();
  }
}

class FakeApprovalPort implements ApprovalPort {
  readonly name = MCPATCH_APPROVAL_PORT_NAME;
  readonly onDisconnect = new FakeChromeEvent<[]>();
  readonly onMessage = new FakeChromeEvent<[unknown]>();
  readonly posted: unknown[] = [];
  readonly sender?: ApprovalMessageSender;
  disconnected = false;

  constructor(sender?: ApprovalMessageSender) {
    if (sender !== undefined) this.sender = sender;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  postMessage(message: unknown): void {
    if (this.disconnected) throw new Error("approval port is disconnected");
    this.posted.push(structuredClone(message));
  }

  emitDisconnect(): void {
    this.disconnected = true;
    this.onDisconnect.emit();
  }

  emitMessage(message: unknown): void {
    this.onMessage.emit(structuredClone(message));
  }
}

function sender(
  overrides: Partial<ApprovalMessageSender> = {},
): ApprovalMessageSender {
  return {
    id: EXTENSION_ID,
    frameId: 0,
    tab: { id: 17 },
    url: `${BASE_URL}?approvalId=${APPROVAL_ID}`,
    ...overrides,
  };
}

function approvalRequired(
  overrides: Partial<ApprovalRequired> = {},
): ApprovalRequired {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "approval_required",
    approvalId: APPROVAL_ID,
    requestId: "request-approval",
    contextId: "tab-1",
    contextRevision: 1,
    origin: "https://example.com",
    tool: "demo.action",
    argsHash: "a".repeat(64),
    expiresAt: "2026-09-15T00:01:00Z",
    ...overrides,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
