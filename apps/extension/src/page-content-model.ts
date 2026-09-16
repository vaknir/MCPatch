import type { JsonObject } from "@mcpatch/protocol";
import type { PackToolReturn } from "@mcpatch/sdk/runtime";

import type { PageCapability, PageToolErrorCode } from "./page-channel.js";
import type { PagePort } from "./page-context-model.js";
import type { SessionScheduler } from "./native-session.js";

export interface ChromePageClientRuntimeApi {
  connect(connectInfo: { readonly name: string }): PagePort;
}

export interface PageAdapter {
  authorizePackTools?(tools: readonly string[]): void;
  capabilities(signal: AbortSignal): Promise<readonly PageCapability[]>;
  execute(
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<PackToolReturn>;
  subscribe?(listener: () => void): () => void;
}

export interface PageLifecycleApi {
  addEventListener(
    type: "pagehide",
    listener: () => void,
    options?: { readonly once?: boolean },
  ): void;
}

export interface PageContentRuntimeOptions {
  readonly expectedOrigin: string;
  readonly handshakeTimeoutMs?: number;
  readonly lifecycle?: PageLifecycleApi;
  readonly retryDelaysMs?: readonly number[];
  readonly scheduler?: SessionScheduler;
}

export class PageAdapterExecutionError extends Error {
  readonly code: PageToolErrorCode;

  constructor(code: PageToolErrorCode) {
    super(`page adapter execution failed: ${code}`);
    this.name = "PageAdapterExecutionError";
    this.code = code;
  }
}
