import {
  encodePageToWorkerMessage,
  PAGE_PROTOCOL_VERSION,
  parsePageToWorkerFrame,
  parseWorkerToPageFrame,
  type PageBinding,
  type PageCapability,
  type PageHelloAck,
} from "./page-channel.js";
import { PageCallExecutor } from "./page-content-executor.js";
import {
  PageAdapterExecutionError,
  type ChromePageClientRuntimeApi,
  type PageAdapter,
  type PageContentRuntimeOptions,
} from "./page-content-model.js";
import { MCPATCH_PAGE_PORT_NAME, type PagePort } from "./page-context-model.js";
import { SnapshotGate } from "./page-snapshot-gate.js";
import {
  IMPLEMENTATION_VERSION,
  systemScheduler,
  type SessionScheduler,
} from "./native-session-model.js";

const CONTENT_IMPLEMENTATION_NAME = "mcpatch-content";
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_DELAYS_MS = [100, 500, 1_000, 2_000] as const;
const MAX_TIMER_DELAY_MS = 29_000;

export class PageContentRuntime {
  readonly #runtime: ChromePageClientRuntimeApi;
  readonly #adapter: PageAdapter;
  readonly #scheduler: SessionScheduler;
  readonly #expectedOrigin: string;
  readonly #handshakeTimeoutMs: number;
  readonly #retryDelaysMs: readonly number[];
  #binding: PageBinding | undefined;
  #authorizedPackTools = new Set<string>();
  #discovery: AbortController | undefined;
  #executor: PageCallExecutor | undefined;
  #generation = 0;
  #handshakeTimer: unknown;
  #port: PagePort | undefined;
  #refreshGeneration = 0;
  /** Canonical capabilities of the last published snapshot, so an unchanged
   * republication costs the bridge nothing. */
  #publishedCapabilities: string | undefined;
  readonly #gate: SnapshotGate;
  #retryAttempt = 0;
  #retryTimer: unknown;
  #running = false;
  #snapshotRevision = 0;
  #unsubscribe: (() => void) | undefined;

  constructor(
    runtime: ChromePageClientRuntimeApi,
    adapter: PageAdapter,
    options: PageContentRuntimeOptions,
  ) {
    this.#runtime = runtime;
    this.#adapter = adapter;
    this.#expectedOrigin = canonicalOrigin(options.expectedOrigin);
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#gate = new SnapshotGate(this.#scheduler);
    this.#handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.#retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    validateTimer(this.#handshakeTimeoutMs);
    if (this.#retryDelaysMs.length === 0) {
      throw new TypeError("page retry delays must not be empty");
    }
    for (const delay of this.#retryDelaysMs) validateTimer(delay);
    this.#adapter.bindContextRevocation?.(() => this.stop());
    options.lifecycle?.addEventListener("pagehide", () => this.stop(), {
      once: true,
    });
  }

  wake(): void {
    this.#running = true;
    if (this.#port === undefined && this.#retryTimer === undefined)
      this.#connect();
  }

  stop(): void {
    this.#running = false;
    const port = this.#port;
    if (port !== undefined && this.#binding !== undefined) {
      this.#send({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_context_closed",
        ...this.#binding,
        reason: "document_unloading",
      });
    }
    this.#detach(true);
    if (this.#retryTimer !== undefined) {
      this.#scheduler.cancel(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }

  refresh(): void {
    if (this.#binding === undefined) return;
    this.#gate.request(() => {
      if (this.#binding !== undefined) this.#publishCapabilities();
    });
  }

  #connect(): void {
    if (!this.#running || this.#port !== undefined) return;
    const generation = ++this.#generation;
    let port: PagePort;
    try {
      port = this.#runtime.connect({ name: MCPATCH_PAGE_PORT_NAME });
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#port = port;
    port.onMessage.addListener((frame) => this.#receive(generation, frame));
    port.onDisconnect.addListener(() => this.#disconnected(generation));
    if (
      !this.#send({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_hello",
        supportedPageProtocolVersions: [PAGE_PROTOCOL_VERSION],
        implementation: {
          name: CONTENT_IMPLEMENTATION_NAME,
          version: IMPLEMENTATION_VERSION,
        },
      })
    ) {
      this.#fail(generation);
      return;
    }
    this.#handshakeTimer = this.#scheduler.schedule(
      () => this.#fail(generation),
      this.#handshakeTimeoutMs,
    );
  }

  #receive(generation: number, frame: unknown): void {
    if (!this.#isCurrent(generation)) return;
    let message;
    try {
      message = parseWorkerToPageFrame(frame);
    } catch {
      this.#fail(generation);
      return;
    }
    if (this.#binding === undefined) {
      if (message.type !== "page_hello_ack") {
        this.#fail(generation);
        return;
      }
      this.#ready(generation, message);
      return;
    }
    if (
      message.type === "page_hello_ack" ||
      !sameBinding(message, this.#binding)
    ) {
      this.#fail(generation);
      return;
    }
    if (message.type === "page_cancel") {
      if (!this.#executor?.cancel(message.requestId, message.tool)) {
        this.#fail(generation);
      }
      return;
    }
    this.#executor?.execute(message);
  }

  #ready(generation: number, binding: PageHelloAck): void {
    if (binding.origin !== this.#expectedOrigin) {
      this.#fail(this.#generation);
      return;
    }
    this.#clearHandshake();
    this.#binding = Object.freeze({
      channelId: binding.channelId,
      contextId: binding.contextId,
      contextRevision: binding.contextRevision,
      tabId: binding.tabId,
      documentId: binding.documentId,
      origin: binding.origin,
    });
    this.#authorizedPackTools = new Set(binding.authorizedPackTools);
    this.#executor = new PageCallExecutor(
      this.#adapter,
      (frame) => this.#postFrame(generation, frame),
      () => this.#fail(generation),
    );
    this.#retryAttempt = 0;
    try {
      this.#adapter.authorizePackTools?.(binding.authorizedPackTools);
      this.#unsubscribe = this.#adapter.subscribe?.(() => this.refresh());
    } catch {
      this.#adapterFailed();
      return;
    }
    this.refresh();
  }

  #publishCapabilities(): void {
    const binding = this.#binding;
    if (binding === undefined) return;
    this.#discovery?.abort();
    const controller = new AbortController();
    this.#discovery = controller;
    const generation = ++this.#refreshGeneration;
    void Promise.resolve()
      .then(() => this.#adapter.capabilities(controller.signal))
      .then(
        (capabilities) => {
          if (
            controller.signal.aborted ||
            this.#binding !== binding ||
            generation !== this.#refreshGeneration
          ) {
            return;
          }
          const snapshotRevision = this.#snapshotRevision + 1;
          const message = {
            pageProtocolVersion: PAGE_PROTOCOL_VERSION,
            type: "page_capability_snapshot",
            ...binding,
            snapshotRevision,
            capabilities,
          } as const;
          let accepted: readonly PageCapability[];
          let published: string;
          try {
            const frame = encodePageToWorkerMessage(message);
            const parsed = parsePageToWorkerFrame(frame);
            if (parsed.type !== "page_capability_snapshot") {
              throw new Error("snapshot invariant failed");
            }
            if (
              parsed.capabilities.some(
                (capability) =>
                  capability.source === "pack" &&
                  !this.#authorizedPackTools.has(capability.name),
              )
            ) {
              throw new Error("adapter reported an unauthorized pack tool");
            }
            const port = this.#port;
            if (port === undefined) throw new Error("page port unavailable");
            published = canonicalCapabilities(parsed.capabilities);
            if (published === this.#publishedCapabilities) return;
            port.postMessage(frame);
            accepted = parsed.capabilities;
          } catch {
            this.#fail(this.#generation);
            return;
          }
          this.#snapshotRevision = snapshotRevision;
          this.#publishedCapabilities = published;
          this.#executor?.setCapabilities(accepted);
        },
        () => {
          if (!controller.signal.aborted) this.#adapterFailed();
        },
      );
  }

  #postFrame(generation: number, frame: string): boolean {
    if (!this.#isCurrent(generation)) return false;
    const port = this.#port;
    if (port === undefined) return false;
    try {
      port.postMessage(frame);
      return true;
    } catch {
      return false;
    }
  }

  #adapterFailed(): void {
    const binding = this.#binding;
    if (binding !== undefined) {
      this.#send({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_context_closed",
        ...binding,
        reason: "adapter_unavailable",
      });
    }
    this.#fail(this.#generation);
  }

  #send(message: Parameters<typeof encodePageToWorkerMessage>[0]): boolean {
    const port = this.#port;
    if (port === undefined) return false;
    try {
      port.postMessage(encodePageToWorkerMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  #disconnected(generation: number): void {
    if (!this.#isCurrent(generation)) return;
    this.#detach(false);
    this.#scheduleRetry();
  }

  #fail(generation: number): void {
    if (!this.#isCurrent(generation)) return;
    this.#detach(true);
    this.#scheduleRetry();
  }

  #detach(disconnect: boolean): void {
    const port = this.#port;
    this.#port = undefined;
    this.#binding = undefined;
    this.#authorizedPackTools.clear();
    this.#executor?.close();
    this.#executor = undefined;
    this.#clearHandshake();
    this.#gate.cancel();
    this.#publishedCapabilities = undefined;
    this.#discovery?.abort();
    this.#discovery = undefined;
    try {
      this.#unsubscribe?.();
    } catch {
      // Adapter cleanup cannot prevent cancellation and port revocation.
    }
    this.#unsubscribe = undefined;
    try {
      this.#adapter.close?.();
    } catch {
      // Authority and pending calls are already revoked at this point.
    }
    if (disconnect) disconnectQuietly(port);
  }

  #scheduleRetry(): void {
    if (!this.#running || this.#retryTimer !== undefined) return;
    const index = Math.min(this.#retryAttempt, this.#retryDelaysMs.length - 1);
    const delay = this.#retryDelaysMs[index];
    if (delay === undefined) throw new Error("page retry invariant failed");
    this.#retryAttempt += 1;
    this.#retryTimer = this.#scheduler.schedule(() => {
      this.#retryTimer = undefined;
      this.#connect();
    }, delay);
  }

  #clearHandshake(): void {
    if (this.#handshakeTimer !== undefined) {
      this.#scheduler.cancel(this.#handshakeTimer);
      this.#handshakeTimer = undefined;
    }
  }

  #isCurrent(generation: number): boolean {
    return this.#port !== undefined && this.#generation === generation;
  }
}

export const emptyPageAdapter: PageAdapter = {
  async capabilities() {
    return [];
  },
  async execute() {
    throw new PageAdapterExecutionError("TOOL_UNAVAILABLE");
  },
};

function sameBinding(left: PageBinding, right: PageBinding): boolean {
  return (
    left.channelId === right.channelId &&
    left.contextId === right.contextId &&
    left.contextRevision === right.contextRevision &&
    left.tabId === right.tabId &&
    left.documentId === right.documentId &&
    left.origin === right.origin
  );
}

function validateTimer(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError("page timer must be a positive sub-30-second integer");
  }
}

function canonicalOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.origin !== value
    ) {
      throw new Error("invalid origin");
    }
    return value;
  } catch {
    throw new TypeError("page content origin must be canonical HTTPS");
  }
}

function disconnectQuietly(port: PagePort | undefined): void {
  try {
    port?.disconnect();
  } catch {
    // A disconnected content port is already terminal.
  }
}

/**
 * A stable string for one capability set, used only to skip republishing an
 * unchanged set. The capabilities come from parsing our own encoded frame, so
 * their shape and key order are already canonical.
 */
function canonicalCapabilities(
  capabilities: readonly PageCapability[],
): string {
  return JSON.stringify(capabilities);
}
