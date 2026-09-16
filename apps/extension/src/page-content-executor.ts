import type { JsonObject } from "@mcpatch/protocol";
import {
  isPackExecutionResult,
  type PackToolReturn,
} from "@mcpatch/sdk/runtime";

import {
  encodePageToWorkerMessage,
  PAGE_PROTOCOL_VERSION,
  type PageBinding,
  type PageCapability,
  type PageToolCall,
  type PageToolErrorCode,
} from "./page-channel.js";
import {
  PageAdapterExecutionError,
  type PageAdapter,
} from "./page-content-model.js";

const MAX_PENDING_CALLS = 64;

interface PendingPageCall {
  readonly controller: AbortController;
  readonly tool: string;
}

export class PageCallExecutor {
  readonly #pending = new Map<string, PendingPageCall>();
  #capabilities = new Set<string>();

  constructor(
    readonly adapter: PageAdapter,
    readonly postFrame: (frame: string) => boolean,
    readonly fail: () => void,
  ) {}

  setCapabilities(capabilities: readonly PageCapability[]): void {
    this.#capabilities = new Set(
      capabilities.map((capability) => capability.name),
    );
  }

  execute(call: PageToolCall): void {
    if (
      this.#pending.has(call.requestId) ||
      this.#pending.size >= MAX_PENDING_CALLS ||
      !this.#capabilities.has(call.tool)
    ) {
      this.#sendError(call, "TOOL_UNAVAILABLE");
      return;
    }
    const pending = {
      controller: new AbortController(),
      tool: call.tool,
    };
    this.#pending.set(call.requestId, pending);
    void Promise.resolve()
      .then(() =>
        this.adapter.execute(
          call.tool,
          structuredClone(call.args) as JsonObject,
          pending.controller.signal,
        ),
      )
      .then(
        (result) => this.#result(call, pending, result),
        (error: unknown) => this.#executionFailed(call, pending, error),
      );
  }

  cancel(requestId: string, tool: string): boolean {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return true;
    if (pending.tool !== tool) return false;
    this.#pending.delete(requestId);
    pending.controller.abort();
    return true;
  }

  close(): void {
    for (const pending of this.#pending.values()) pending.controller.abort();
    this.#pending.clear();
    this.#capabilities.clear();
  }

  #result(
    call: PageToolCall,
    pending: PendingPageCall,
    value: PackToolReturn,
  ): void {
    if (!this.#isPending(call.requestId, pending)) return;
    this.#pending.delete(call.requestId);
    let frame: string;
    try {
      const execution = isPackExecutionResult(value)
        ? { result: value.result, content: [...value.content] }
        : { result: value };
      frame = encodePageToWorkerMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_tool_result",
        ...callBinding(call),
        requestId: call.requestId,
        tool: call.tool,
        ...execution,
      });
    } catch {
      this.#sendError(call, "RESULT_INVALID");
      return;
    }
    if (!this.postFrame(frame)) this.fail();
  }

  #executionFailed(
    call: PageToolCall,
    pending: PendingPageCall,
    error: unknown,
  ): void {
    if (!this.#isPending(call.requestId, pending)) return;
    this.#pending.delete(call.requestId);
    this.#sendError(
      call,
      error instanceof PageAdapterExecutionError
        ? error.code
        : "EXECUTION_FAILED",
    );
  }

  #sendError(call: PageToolCall, code: PageToolErrorCode): void {
    try {
      const frame = encodePageToWorkerMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_tool_error",
        ...callBinding(call),
        requestId: call.requestId,
        tool: call.tool,
        code,
      });
      if (!this.postFrame(frame)) this.fail();
    } catch {
      this.fail();
    }
  }

  #isPending(requestId: string, pending: PendingPageCall): boolean {
    return this.#pending.get(requestId) === pending;
  }
}

function callBinding(call: PageToolCall): PageBinding {
  return {
    channelId: call.channelId,
    contextId: call.contextId,
    contextRevision: call.contextRevision,
    tabId: call.tabId,
    documentId: call.documentId,
    origin: call.origin,
  };
}
