import type { JsonObject } from "@mcpatch/protocol";

import {
  PAGE_PROTOCOL_VERSION,
  parsePageToWorkerFrame,
  type PageBinding,
  type PageCapabilitySnapshot,
} from "./page-channel.js";
import {
  MCPATCH_PAGE_PORT_NAME,
  type ActivePageContext,
  type ChromePageServiceRuntimeApi,
  type PageAuthority,
  type PageContextOwnerOptions,
  type PageContextSnapshot,
  type PageInvoker,
  type PageInvocationResult,
  type PageOwnerCloseReason,
  type PagePort,
  type PageSenderIdentity,
} from "./page-context-model.js";
import { PageInvocationRouter, send } from "./page-context-invocation.js";
import { validatePageSender } from "./page-context-sender.js";
import {
  authorizationPermits,
  authorizePage,
  disconnectPagePort,
  matchesPageBinding,
  randomPageChannelId,
  validatePageTimer,
  type OwnedPagePort,
} from "./page-context-session.js";
import {
  IMPLEMENTATION_NAME,
  IMPLEMENTATION_VERSION,
  systemScheduler,
  type SessionScheduler,
} from "./native-session-model.js";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_CALL_TIMEOUT_MS = 25_000;
const MAX_PAGE_PORTS = 128;
const MAX_NEGOTIATING_PORTS_PER_TAB = 4;

export const denyPageAuthority: PageAuthority = {
  authorize() {
    return undefined;
  },
};

export class PageContextOwner implements PageInvoker {
  readonly #runtime: ChromePageServiceRuntimeApi;
  readonly #authority: PageAuthority;
  readonly #scheduler: SessionScheduler;
  readonly #handshakeTimeoutMs: number;
  readonly #randomId: () => string;
  readonly #hooks: Omit<PageContextOwnerOptions, "authority">;
  readonly #invocations: PageInvocationRouter;
  readonly #ports = new Map<PagePort, OwnedPagePort>();
  readonly #contexts = new Map<string, OwnedPagePort>();
  readonly #tabs = new Map<number, OwnedPagePort>();
  readonly #lastRevisions = new Map<number, number>();

  constructor(
    runtime: ChromePageServiceRuntimeApi,
    options: PageContextOwnerOptions,
  ) {
    this.#runtime = runtime;
    this.#authority = options.authority;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.#randomId = options.randomId ?? randomPageChannelId;
    this.#hooks = options;
    validatePageTimer(this.#handshakeTimeoutMs);
    validatePageTimer(callTimeoutMs);
    this.#invocations = new PageInvocationRouter(
      this.#scheduler,
      callTimeoutMs,
    );
    runtime.onConnect.addListener((port) => this.#connected(port));
  }

  get activeContexts(): readonly ActivePageContext[] {
    return Object.freeze(
      [...this.#contexts.values()]
        .filter((session) => session.binding !== undefined)
        .map((session) =>
          Object.freeze({
            binding: session.binding as PageBinding,
            url: session.identity.url,
            capabilities: new Set(session.capabilities),
            snapshotRevision: session.snapshotRevision,
          }),
        )
        .sort((left, right) => left.binding.tabId - right.binding.tabId),
    );
  }

  invoke(
    contextId: string,
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<PageInvocationResult> {
    const session = this.#contexts.get(contextId);
    const authorization =
      session === undefined ? undefined : this.#authorize(session.identity);
    if (
      session !== undefined &&
      !authorizationPermits(session, authorization)
    ) {
      this.#close(session, "pack_disabled", true);
      return this.#invocations.invoke(undefined, tool, args, signal);
    }
    return this.#invocations.invoke(session, tool, args, signal);
  }

  closeAll(reason: PageOwnerCloseReason): void {
    for (const session of [...this.#ports.values()]) {
      this.#close(session, reason, true);
    }
  }

  revokeOrigin(origin: string): void {
    for (const session of [...this.#ports.values()]) {
      if (session.identity.origin === origin) {
        this.#close(session, "pack_disabled", true);
      }
    }
  }

  #connected(port: PagePort): void {
    if (port.name !== MCPATCH_PAGE_PORT_NAME) return;
    const identity = validatePageSender(port.sender, this.#runtime.id);
    const authorization =
      identity === undefined ? undefined : this.#authorize(identity);
    const tabPortCount =
      identity === undefined
        ? 0
        : [...this.#ports.values()].filter(
            (session) => session.identity.tabId === identity.tabId,
          ).length;
    if (
      identity === undefined ||
      authorization === undefined ||
      this.#ports.size >= MAX_PAGE_PORTS ||
      tabPortCount >= MAX_NEGOTIATING_PORTS_PER_TAB
    ) {
      disconnectPagePort(port);
      return;
    }
    const session: OwnedPagePort = {
      identity,
      port,
      pending: new Map(),
      capabilities: Object.freeze(new Set<string>()),
      packCapabilities: Object.freeze(new Set<string>()),
      phase: "negotiating",
      snapshotRevision: 0,
    };
    this.#ports.set(port, session);
    port.onMessage.addListener((frame) => this.#receive(session, frame));
    port.onDisconnect.addListener(() =>
      this.#close(session, "navigation", false),
    );
    session.handshakeTimer = this.#scheduler.schedule(() => {
      session.handshakeTimer = undefined;
      this.#close(session, "disconnected", true);
    }, this.#handshakeTimeoutMs);
  }

  #receive(session: OwnedPagePort, frame: unknown): void {
    if (this.#ports.get(session.port) !== session) return;
    let message;
    try {
      message = parsePageToWorkerFrame(frame);
    } catch {
      this.#close(session, "disconnected", true);
      return;
    }
    if (session.phase === "negotiating") {
      if (message.type !== "page_hello") {
        this.#close(session, "disconnected", true);
        return;
      }
      this.#establish(session);
      return;
    }
    if (
      message.type === "page_hello" ||
      !matchesPageBinding(session, message)
    ) {
      this.#close(session, "disconnected", true);
      return;
    }
    if (!authorizationPermits(session, this.#authorize(session.identity))) {
      this.#close(session, "pack_disabled", true);
      return;
    }
    switch (message.type) {
      case "page_capability_snapshot":
        this.#snapshot(session, message);
        break;
      case "page_tool_result":
      case "page_tool_error":
        if (!this.#invocations.complete(session, message)) {
          this.#close(session, "disconnected", true);
        }
        break;
      case "page_context_closed":
        this.#close(
          session,
          message.reason === "document_unloading"
            ? "navigation"
            : "disconnected",
          true,
        );
        break;
    }
  }

  #establish(session: OwnedPagePort): void {
    const authorization = this.#authorize(session.identity);
    const existing = this.#tabs.get(session.identity.tabId);
    if (
      authorization === undefined ||
      existing?.identity.documentId === session.identity.documentId
    ) {
      this.#close(session, "disconnected", true);
      return;
    }
    const contextRevision =
      (this.#lastRevisions.get(session.identity.tabId) ?? 0) + 1;
    this.#lastRevisions.set(session.identity.tabId, contextRevision);
    const binding: PageBinding = Object.freeze({
      channelId: this.#randomId(),
      contextId: `page.${session.identity.tabId}`,
      contextRevision,
      tabId: session.identity.tabId,
      documentId: session.identity.documentId,
      origin: session.identity.origin,
    });
    session.binding = binding;
    session.phase = "ready";
    this.#clearHandshake(session);
    if (
      !send(session, {
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_hello_ack",
        selectedPageProtocolVersion: PAGE_PROTOCOL_VERSION,
        implementation: {
          name: IMPLEMENTATION_NAME,
          version: IMPLEMENTATION_VERSION,
        },
        authorizedPackTools: [...authorization.packTools].sort(),
        ...binding,
      })
    ) {
      this.#close(session, "disconnected", true);
      return;
    }
    if (existing !== undefined) this.#close(existing, "navigation", true);
    this.#tabs.set(binding.tabId, session);
    this.#contexts.set(binding.contextId, session);
  }

  #snapshot(session: OwnedPagePort, message: PageCapabilitySnapshot): void {
    const authorization = this.#authorize(session.identity);
    if (authorization === undefined) {
      this.#close(session, "pack_disabled", true);
      return;
    }
    if (
      message.snapshotRevision <= session.snapshotRevision ||
      message.capabilities.some(
        (capability) =>
          capability.source === "pack" &&
          !authorization.packTools.has(capability.name),
      )
    ) {
      this.#close(session, "disconnected", true);
      return;
    }
    session.snapshotRevision = message.snapshotRevision;
    session.capabilities = Object.freeze(
      new Set(message.capabilities.map((capability) => capability.name)),
    );
    const nativeNames = new Set(
      message.capabilities
        .filter((capability) => capability.source === "native_webmcp")
        .map((capability) => capability.name),
    );
    session.packCapabilities = Object.freeze(
      new Set(
        message.capabilities
          .filter(
            (capability) =>
              capability.source === "pack" && !nativeNames.has(capability.name),
          )
          .map((capability) => capability.name),
      ),
    );
    const snapshot: PageContextSnapshot = Object.freeze({
      binding: session.binding as PageBinding,
      url: session.identity.url,
      snapshotRevision: message.snapshotRevision,
      capabilities: message.capabilities,
    });
    try {
      this.#hooks.onSnapshot?.(snapshot);
    } catch {
      this.#close(session, "disconnected", true);
    }
  }

  #authorize(identity: PageSenderIdentity) {
    return authorizePage(this.#authority, identity);
  }

  #close(
    session: OwnedPagePort,
    reason: PageOwnerCloseReason,
    disconnect: boolean,
  ): void {
    if (this.#ports.get(session.port) !== session) return;
    this.#ports.delete(session.port);
    this.#clearHandshake(session);
    if (session.binding !== undefined) {
      if (this.#tabs.get(session.binding.tabId) === session) {
        this.#tabs.delete(session.binding.tabId);
      }
      if (this.#contexts.get(session.binding.contextId) === session) {
        this.#contexts.delete(session.binding.contextId);
      }
    }
    this.#invocations.cancelAll(session);
    if (disconnect) disconnectPagePort(session.port);
    if (session.binding !== undefined && session.snapshotRevision > 0) {
      try {
        this.#hooks.onClosed?.(session.binding.contextId, reason);
      } catch {
        // Revocation cannot depend on observer behavior.
      }
    }
  }

  #clearHandshake(session: OwnedPagePort): void {
    if (session.handshakeTimer !== undefined) {
      this.#scheduler.cancel(session.handshakeTimer);
      session.handshakeTimer = undefined;
    }
  }
}
