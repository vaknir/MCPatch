import {
  PROTOCOL_VERSION,
  selectProtocolVersion,
  type Message,
} from "@mcpatch/protocol";

import type { ChromeEvent } from "./lifecycle.js";

export const MCPATCH_NATIVE_HOST_NAME = "dev.mcpatch.bridge";
export const IMPLEMENTATION_NAME = "mcpatch-extension";
export const IMPLEMENTATION_VERSION = "0.1.0";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;
const MAX_TIMER_DELAY_MS = 29_000;

export interface NativePort {
  readonly onDisconnect: ChromeEvent<[]>;
  readonly onMessage: ChromeEvent<[unknown]>;
  disconnect(): void;
  postMessage(message: unknown): void;
}

export interface ChromeNativeRuntimeApi {
  connectNative(application: string): NativePort;
}

export interface SessionScheduler {
  cancel(handle: unknown): void;
  now(): Date;
  schedule(callback: () => void, delayMs: number): unknown;
}

export type BridgeApplicationMessage = Extract<
  Message,
  {
    type:
      | "approval_required"
      | "cancel"
      | "connection_error"
      | "heartbeat"
      | "tool_call";
  }
>;

export type NativeSessionState =
  | { readonly phase: "negotiating" }
  | { readonly phase: "stopped" }
  | { readonly phase: "waiting_retry" }
  | {
      readonly phase: "ready";
      readonly connectionId: string;
      readonly protocolVersion: number;
    };

export interface NativeSessionOptions {
  readonly handshakeTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly onMessage?: (message: BridgeApplicationMessage) => void;
  readonly onDisconnected?: () => void;
  readonly onReady?: () => void;
  readonly onStopping?: () => void;
  readonly retryDelaysMs?: readonly number[];
  readonly scheduler?: SessionScheduler;
  readonly supportedProtocolVersions?: readonly number[];
}

export interface SessionConfig {
  readonly handshakeTimeoutMs: number;
  readonly heartbeatIntervalMs: number;
  readonly retryDelaysMs: readonly number[];
  readonly supportedProtocolVersions: readonly number[];
}

export const systemScheduler: SessionScheduler = {
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

export function createSessionConfig(
  options: NativeSessionOptions,
): SessionConfig {
  const config: SessionConfig = {
    handshakeTimeoutMs:
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
    heartbeatIntervalMs:
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    retryDelaysMs: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    supportedProtocolVersions: options.supportedProtocolVersions ?? [
      PROTOCOL_VERSION,
    ],
  };
  validateConfig(config);
  return config;
}

export function isExtensionApplicationMessage(message: Message): boolean {
  switch (message.type) {
    case "approval_result":
    case "capability_snapshot":
    case "connection_error":
    case "context_closed":
    case "heartbeat":
    case "tool_error":
    case "tool_result":
      return true;
    default:
      return false;
  }
}

export function isBridgeApplicationMessage(
  message: Message,
): message is BridgeApplicationMessage {
  switch (message.type) {
    case "approval_required":
    case "cancel":
    case "connection_error":
    case "heartbeat":
    case "tool_call":
      return true;
    default:
      return false;
  }
}

export function disconnectQuietly(port: NativePort | undefined): void {
  try {
    port?.disconnect();
  } catch {
    // A disconnected Chrome Port is already in the required terminal state.
  }
}

function validateConfig(config: SessionConfig): void {
  selectProtocolVersion(
    config.supportedProtocolVersions,
    config.supportedProtocolVersions,
  );
  validateDelay(config.handshakeTimeoutMs);
  validateDelay(config.heartbeatIntervalMs);
  if (config.retryDelaysMs.length === 0) {
    throw new TypeError("retry delays must not be empty");
  }
  for (const delay of config.retryDelaysMs) validateDelay(delay);
}

function validateDelay(delayMs: number): void {
  if (
    !Number.isSafeInteger(delayMs) ||
    delayMs < 1 ||
    delayMs > MAX_TIMER_DELAY_MS
  ) {
    throw new TypeError(
      "session timer must be a positive sub-30-second integer",
    );
  }
}
