import {
  parseMessage,
  PROTOCOL_VERSION,
  verifySelectedVersion,
  type Heartbeat,
  type Message,
} from "@mcpatch/protocol";

import {
  createSessionConfig,
  disconnectQuietly,
  IMPLEMENTATION_NAME,
  IMPLEMENTATION_VERSION,
  isBridgeApplicationMessage,
  isExtensionApplicationMessage,
  MCPATCH_NATIVE_HOST_NAME,
  systemScheduler,
  type BridgeApplicationMessage,
  type ChromeNativeRuntimeApi,
  type NativePort,
  type NativeSessionOptions,
  type NativeSessionState,
  type SessionConfig,
  type SessionScheduler,
} from "./native-session-model.js";

export { MCPATCH_NATIVE_HOST_NAME } from "./native-session-model.js";
export type {
  BridgeApplicationMessage,
  ChromeNativeRuntimeApi,
  NativePort,
  NativeSessionOptions,
  NativeSessionState,
  SessionScheduler,
} from "./native-session-model.js";

interface ActivePort {
  readonly generation: number;
  readonly port: NativePort;
}

export class NativeSessionSupervisor {
  readonly #runtime: ChromeNativeRuntimeApi;
  readonly #scheduler: SessionScheduler;
  readonly #config: SessionConfig;
  readonly #onMessage:
    ((message: BridgeApplicationMessage) => void) | undefined;
  #active: ActivePort | undefined;
  #generation = 0;
  #handshakeTimer: unknown;
  #heartbeatSequence = 0;
  #heartbeatTimer: unknown;
  #retryAttempt = 0;
  #retryTimer: unknown;
  #running = false;
  #state: NativeSessionState = { phase: "stopped" };

  constructor(
    runtime: ChromeNativeRuntimeApi,
    options: NativeSessionOptions = {},
  ) {
    this.#runtime = runtime;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#onMessage = options.onMessage;
    this.#config = createSessionConfig(options);
  }

  get state(): NativeSessionState {
    return this.#state;
  }

  wake(): void {
    this.#running = true;
    if (this.#active === undefined && this.#retryTimer === undefined) {
      this.#connect();
    }
  }

  stop(): void {
    this.#running = false;
    this.#clearTimers();
    const active = this.#active;
    this.#active = undefined;
    this.#state = { phase: "stopped" };
    disconnectQuietly(active?.port);
  }

  send(message: Message): boolean {
    const active = this.#active;
    if (active === undefined || this.#state.phase !== "ready") return false;

    if (
      !isExtensionApplicationMessage(message) ||
      message.protocolVersion !== this.#state.protocolVersion
    ) {
      this.#fail(active.generation);
      return false;
    }
    try {
      active.port.postMessage(parseMessage(message));
      return true;
    } catch {
      this.#fail(active.generation);
      return false;
    }
  }

  #connect(): void {
    if (!this.#running || this.#active !== undefined) return;
    this.#clearRetryTimer();

    const generation = ++this.#generation;
    let port: NativePort;
    try {
      port = this.#runtime.connectNative(MCPATCH_NATIVE_HOST_NAME);
    } catch {
      this.#scheduleRetry();
      return;
    }

    this.#active = { generation, port };
    this.#state = { phase: "negotiating" };
    port.onMessage.addListener((value) => {
      this.#receive(generation, value);
    });
    port.onDisconnect.addListener(() => {
      this.#disconnected(generation);
    });

    try {
      port.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        type: "hello",
        role: "extension",
        supportedProtocolVersions: [...this.#config.supportedProtocolVersions],
        implementation: {
          name: IMPLEMENTATION_NAME,
          version: IMPLEMENTATION_VERSION,
        },
      } satisfies Message);
    } catch {
      this.#fail(generation);
      return;
    }

    if (this.#isCurrent(generation) && this.#state.phase === "negotiating") {
      this.#handshakeTimer = this.#scheduler.schedule(() => {
        this.#handshakeTimer = undefined;
        this.#fail(generation);
      }, this.#config.handshakeTimeoutMs);
    }
  }

  #receive(generation: number, value: unknown): void {
    if (!this.#isCurrent(generation)) return;

    let message: Message;
    try {
      message = parseMessage(value);
    } catch {
      this.#fail(generation);
      return;
    }

    if (this.#state.phase === "negotiating") {
      this.#receiveAcknowledgement(generation, message);
      return;
    }
    if (this.#state.phase !== "ready") return;
    if (
      message.protocolVersion !== this.#state.protocolVersion ||
      !isBridgeApplicationMessage(message)
    ) {
      this.#fail(generation);
      return;
    }
    if (message.type === "connection_error" && message.fatal) {
      this.#fail(generation);
      return;
    }
    if (message.type === "heartbeat" || message.type === "connection_error") {
      return;
    }
    if (this.#onMessage === undefined) {
      this.#fail(generation);
      return;
    }
    try {
      this.#onMessage(message);
    } catch {
      this.#fail(generation);
    }
  }

  #receiveAcknowledgement(generation: number, message: Message): void {
    if (message.type !== "hello_ack") {
      this.#fail(generation);
      return;
    }
    try {
      verifySelectedVersion(
        this.#config.supportedProtocolVersions,
        message.supportedProtocolVersions,
        message.selectedProtocolVersion,
      );
    } catch {
      this.#fail(generation);
      return;
    }

    this.#clearHandshakeTimer();
    this.#retryAttempt = 0;
    this.#state = {
      phase: "ready",
      connectionId: message.connectionId,
      protocolVersion: message.selectedProtocolVersion,
    };
    this.#scheduleHeartbeat(generation);
  }

  #scheduleHeartbeat(generation: number): void {
    this.#clearHeartbeatTimer();
    this.#heartbeatTimer = this.#scheduler.schedule(() => {
      this.#heartbeatTimer = undefined;
      if (!this.#isCurrent(generation) || this.#state.phase !== "ready") {
        return;
      }
      const heartbeat: Heartbeat = {
        protocolVersion: PROTOCOL_VERSION,
        type: "heartbeat",
        heartbeatId: `heartbeat.${generation}.${++this.#heartbeatSequence}`,
        sentAt: this.#scheduler.now().toISOString(),
      };
      if (this.send(heartbeat) && this.#isCurrent(generation)) {
        this.#scheduleHeartbeat(generation);
      }
    }, this.#config.heartbeatIntervalMs);
  }

  #disconnected(generation: number): void {
    if (!this.#isCurrent(generation)) return;
    this.#detachCurrent(false);
    this.#scheduleRetry();
  }

  #fail(generation: number): void {
    if (!this.#isCurrent(generation)) return;
    this.#detachCurrent(true);
    this.#scheduleRetry();
  }

  #detachCurrent(disconnect: boolean): void {
    const active = this.#active;
    this.#active = undefined;
    this.#clearHandshakeTimer();
    this.#clearHeartbeatTimer();
    if (disconnect) disconnectQuietly(active?.port);
  }

  #scheduleRetry(): void {
    if (
      !this.#running ||
      this.#active !== undefined ||
      this.#retryTimer !== undefined
    ) {
      return;
    }
    this.#state = { phase: "waiting_retry" };
    const delays = this.#config.retryDelaysMs;
    const index = Math.min(this.#retryAttempt, delays.length - 1);
    const delay = delays[index];
    if (delay === undefined) throw new Error("retry delay invariant violated");
    this.#retryAttempt += 1;
    this.#retryTimer = this.#scheduler.schedule(() => {
      this.#retryTimer = undefined;
      this.#connect();
    }, delay);
  }

  #isCurrent(generation: number): boolean {
    return this.#active?.generation === generation;
  }

  #clearTimers(): void {
    this.#clearHandshakeTimer();
    this.#clearHeartbeatTimer();
    this.#clearRetryTimer();
  }

  #clearHandshakeTimer(): void {
    if (this.#handshakeTimer !== undefined) {
      this.#scheduler.cancel(this.#handshakeTimer);
      this.#handshakeTimer = undefined;
    }
  }

  #clearHeartbeatTimer(): void {
    if (this.#heartbeatTimer !== undefined) {
      this.#scheduler.cancel(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer !== undefined) {
      this.#scheduler.cancel(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }
}
