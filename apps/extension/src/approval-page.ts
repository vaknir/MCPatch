import {
  MCPATCH_APPROVAL_PORT_NAME,
  type ApprovalDecisionMessage,
  type ApprovalPort,
  type ApprovalPresentation,
  type ApprovalReady,
  type ApprovalWithdrawn,
} from "./approval-model.js";

declare const chrome: {
  readonly runtime: {
    connect(connectInfo: { readonly name: string }): ApprovalPort;
  };
};

const approvalId = requiredApprovalId(globalThis.location.href);

const port = chrome.runtime.connect({ name: MCPATCH_APPROVAL_PORT_NAME });
const tool = requiredElement("tool");
const origin = requiredElement("origin");
const args = requiredElement("args");
const hash = requiredElement("args-hash");
const expires = requiredElement("expires-at");
const requester = requiredElement("requester");
const withdrawn = requiredElement("withdrawn");
const approve = requiredButton("approve");
const deny = requiredButton("deny");
let presented = false;
let decided = false;

port.onMessage.addListener((value) => {
  const withdrawal = parseWithdrawal(value);
  if (withdrawal !== undefined) {
    if (withdrawal.approvalId === approvalId) withdraw();
    port.disconnect();
    return;
  }
  const presentation = parsePresentation(value);
  if (presentation === undefined || presentation.approvalId !== approvalId) {
    port.disconnect();
    return;
  }
  tool.textContent = presentation.tool;
  origin.textContent = presentation.origin;
  args.textContent = renderArguments(presentation.args);
  hash.textContent = presentation.argsHash;
  expires.textContent = new Date(presentation.expiresAt).toLocaleString();
  requester.textContent = `${presentation.requester.client} (${presentation.requester.session})`;
  approve.disabled = false;
  deny.disabled = false;
  presented = true;
});

approve.addEventListener("click", () => decide("approved"));
deny.addEventListener("click", () => decide("denied"));
const ready: ApprovalReady = { type: "approval_ready", approvalId };
port.postMessage(ready);

function decide(decision: "approved" | "denied"): void {
  if (!presented || decided) return;
  decided = true;
  approve.disabled = true;
  deny.disabled = true;
  const message: ApprovalDecisionMessage = {
    type: "approval_decision",
    approvalId,
    decision,
  };
  port.postMessage(message);
}

/** The caller gave up: nothing was approved, and no decision can be sent. */
function withdraw(): void {
  decided = true;
  approve.disabled = true;
  deny.disabled = true;
  withdrawn.hidden = false;
}

function parseWithdrawal(value: unknown): ApprovalWithdrawn | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !["type", "approvalId"].every((key) => Object.hasOwn(value, key))
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return record["type"] === "approval_withdrawn" &&
    typeof record["approvalId"] === "string"
    ? (value as ApprovalWithdrawn)
    : undefined;
}

function requiredApprovalId(href: string): string {
  const value = new URL(href).searchParams.get("approvalId");
  if (value === null) throw new Error("missing approval identifier");
  return value;
}

const PRESENTATION_KEYS = [
  "type",
  "approvalId",
  "tool",
  "origin",
  "args",
  "argsHash",
  "expiresAt",
  "requester",
] as const;

function parsePresentation(value: unknown): ApprovalPresentation | undefined {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== PRESENTATION_KEYS.length ||
    !PRESENTATION_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return undefined;
  }
  return value["type"] === "approval_present" &&
    typeof value["approvalId"] === "string" &&
    typeof value["tool"] === "string" &&
    typeof value["origin"] === "string" &&
    isPlainObject(value["args"]) &&
    typeof value["argsHash"] === "string" &&
    typeof value["expiresAt"] === "string" &&
    isRequester(value["requester"])
    ? (value as unknown as ApprovalPresentation)
    : undefined;
}

function isRequester(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 2 &&
    typeof value["client"] === "string" &&
    typeof value["session"] === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Arguments are shown as pretty-printed JSON through `textContent`, so a
 * value that contains markup or a prompt-injection sentence is displayed as
 * data and never interpreted. An empty object is spelled out so the user sees
 * that the call carries nothing rather than a blank row.
 */
function renderArguments(value: Record<string, unknown>): string {
  return Object.keys(value).length === 0
    ? "(no arguments)"
    : JSON.stringify(value, null, 2);
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing approval element: ${id}`);
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`approval element is not a button: ${id}`);
  }
  return element;
}
