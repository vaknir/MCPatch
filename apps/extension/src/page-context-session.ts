import type { PageBinding } from "./page-channel.js";
import type {
  PageInvocationResult,
  PageInvocationError,
  PageAuthority,
  PageAuthorization,
  PagePort,
  PageSenderIdentity,
} from "./page-context-model.js";

const MAX_TIMER_DELAY_MS = 29_000;
const TOOL_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export interface PendingInvocation {
  readonly reject: (error: PageInvocationError) => void;
  readonly resolve: (value: PageInvocationResult) => void;
  readonly timer: unknown;
  readonly tool: string;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export interface OwnedPagePort {
  readonly identity: PageSenderIdentity;
  readonly port: PagePort;
  readonly pending: Map<string, PendingInvocation>;
  binding?: PageBinding;
  capabilities: ReadonlySet<string>;
  packCapabilities: ReadonlySet<string>;
  handshakeTimer?: unknown;
  phase: "negotiating" | "ready";
  snapshotRevision: number;
}

export function authorizePage(
  authority: PageAuthority,
  identity: PageSenderIdentity,
): PageAuthorization | undefined {
  try {
    const candidate = authority.authorize(identity);
    if (candidate === undefined) return undefined;
    const packTools = [...candidate.packTools];
    if (
      packTools.length > 128 ||
      packTools.some(
        (tool) =>
          typeof tool !== "string" ||
          tool.length > 128 ||
          !TOOL_NAME.test(tool),
      ) ||
      new Set(packTools).size !== packTools.length
    ) {
      return undefined;
    }
    return Object.freeze({ packTools: Object.freeze(new Set(packTools)) });
  } catch {
    return undefined;
  }
}

export function authorizationPermits(
  session: OwnedPagePort,
  authorization: PageAuthorization | undefined,
): authorization is PageAuthorization {
  return (
    authorization !== undefined &&
    [...session.packCapabilities].every((tool) =>
      authorization.packTools.has(tool),
    )
  );
}

export function matchesPageBinding(
  session: OwnedPagePort,
  message: PageBinding,
): boolean {
  const binding = session.binding;
  return (
    binding !== undefined &&
    message.channelId === binding.channelId &&
    message.contextId === binding.contextId &&
    message.contextRevision === binding.contextRevision &&
    message.tabId === binding.tabId &&
    message.documentId === binding.documentId &&
    message.origin === binding.origin
  );
}

export function randomPageChannelId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `channel.${[...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function validatePageTimer(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError("page timer must be a positive sub-30-second integer");
  }
}

export function disconnectPagePort(port: PagePort | undefined): void {
  try {
    port?.disconnect();
  } catch {
    // A disconnected content port is already in the required terminal state.
  }
}
