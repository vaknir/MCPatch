import type { JsonObject, JsonValue } from "@mcpatch/protocol";

import type { ChromeEvent } from "./lifecycle.js";
import type {
  PageBinding,
  PageCapability,
  PageToolErrorCode,
} from "./page-channel.js";
import type { SessionScheduler } from "./native-session.js";

export const MCPATCH_PAGE_PORT_NAME = "mcpatch.page.v2";

export interface PageMessageSender {
  readonly id?: string;
  readonly documentId?: string;
  readonly documentLifecycle?: string;
  readonly frameId?: number;
  readonly origin?: string;
  readonly tab?: { readonly id?: number };
  readonly url?: string;
}

export interface PagePort {
  readonly name: string;
  readonly onDisconnect: ChromeEvent<[]>;
  readonly onMessage: ChromeEvent<[unknown]>;
  readonly sender?: PageMessageSender;
  disconnect(): void;
  postMessage(message: unknown): void;
}

export interface ChromePageServiceRuntimeApi {
  readonly id: string;
  readonly onConnect: ChromeEvent<[PagePort]>;
}

export interface PageSenderIdentity {
  readonly tabId: number;
  readonly documentId: string;
  readonly url: string;
  readonly origin: string;
}

export interface PageAuthorization {
  readonly packTools: ReadonlySet<string>;
}

export interface PageAuthority {
  authorize(identity: PageSenderIdentity): PageAuthorization | undefined;
}

export interface PageContextSnapshot {
  readonly binding: PageBinding;
  readonly url: string;
  readonly snapshotRevision: number;
  readonly capabilities: readonly PageCapability[];
}

export type PageOwnerCloseReason =
  "disconnected" | "navigation" | "pack_disabled";

export interface PageContextOwnerHooks {
  readonly onClosed?: (contextId: string, reason: PageOwnerCloseReason) => void;
  readonly onSnapshot?: (snapshot: PageContextSnapshot) => void;
}

export interface PageContextOwnerOptions extends PageContextOwnerHooks {
  readonly authority: PageAuthority;
  readonly callTimeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly randomId?: () => string;
  readonly scheduler?: SessionScheduler;
}

export interface ActivePageContext {
  readonly binding: PageBinding;
  readonly url: string;
  readonly capabilities: ReadonlySet<string>;
  readonly snapshotRevision: number;
}

export type PageInvocationErrorCode = PageToolErrorCode | "TIMEOUT";

export class PageInvocationError extends Error {
  readonly code: PageInvocationErrorCode;

  constructor(code: PageInvocationErrorCode) {
    super(`page invocation failed: ${code}`);
    this.name = "PageInvocationError";
    this.code = code;
  }
}

export interface PageInvoker {
  invoke(
    contextId: string,
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<JsonValue>;
}
