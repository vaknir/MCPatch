import { PackToolExecutionError } from "@mcpatch/sdk/runtime";
import {
  PROTOCOL_VERSION,
  type JsonValue,
  type ToolCall,
  type ToolError,
  type ToolResult,
} from "@mcpatch/protocol";

import type { BridgeApplicationMessage } from "./native-session-model.js";
import { matchesRuntimeSchema } from "./runtime-schema.js";
import type {
  ActiveContext,
  MessageSender,
  RuntimeRoute,
} from "./compiled-pack-model.js";

interface PendingCall {
  readonly contextId: string;
  readonly contextRevision: number;
  readonly controller: AbortController;
}

export class CompiledPackCallDispatcher {
  readonly #send: MessageSender;
  readonly #pending = new Map<string, PendingCall>();

  constructor(send: MessageSender) {
    this.#send = send;
  }

  handle(
    message: BridgeApplicationMessage,
    contexts: ReadonlyMap<string, ActiveContext>,
  ): boolean {
    if (message.type === "cancel") {
      const pending = this.#pending.get(message.requestId);
      if (pending !== undefined) {
        this.#pending.delete(message.requestId);
        pending.controller.abort();
      }
      return true;
    }
    if (message.type !== "tool_call") return false;

    const checked = this.#routeCall(message, contexts);
    if ("code" in checked) {
      this.#send(toolError(message, checked.code));
      return true;
    }
    this.#execute(message, checked.context, checked.route);
    return true;
  }

  abortContext(context: ActiveContext): void {
    for (const [requestId, pending] of this.#pending) {
      if (
        pending.contextId === context.contextId &&
        pending.contextRevision === context.contextRevision
      ) {
        this.#pending.delete(requestId);
        pending.controller.abort();
      }
    }
  }

  #routeCall(
    call: ToolCall,
    contexts: ReadonlyMap<string, ActiveContext>,
  ):
    | { readonly context: ActiveContext; readonly route: RuntimeRoute }
    | { readonly code: ToolError["code"] } {
    const context = contexts.get(call.contextId);
    if (
      context === undefined ||
      context.contextRevision !== call.contextRevision
    ) {
      return { code: "CONTEXT_NOT_FOUND" };
    }
    if (context.origin !== call.origin) return { code: "ORIGIN_MISMATCH" };
    const route = context.routes.get(call.tool);
    if (route === undefined) return { code: "TOOL_NOT_FOUND" };
    if (
      this.#pending.has(call.requestId) ||
      !matchesRuntimeSchema(route.inputSchema, call.args)
    ) {
      return { code: "INVALID_REQUEST" };
    }
    return { context, route };
  }

  #execute(call: ToolCall, context: ActiveContext, route: RuntimeRoute): void {
    const controller = new AbortController();
    const pending = Object.freeze({
      contextId: context.contextId,
      contextRevision: context.contextRevision,
      controller,
    });
    this.#pending.set(call.requestId, pending);
    const executionContext = Object.freeze({
      contextId: context.contextId,
      origin: context.origin,
      signal: controller.signal,
    });
    void Promise.resolve()
      .then(() => route.execute(executionContext, call.args))
      .then(
        (result) => {
          if (!this.#isPending(call.requestId, pending)) return;
          if (!matchesRuntimeSchema(route.outputSchema, result)) {
            this.#send(toolError(call, "RESULT_INVALID"));
            return;
          }
          const response: ToolResult = {
            protocolVersion: PROTOCOL_VERSION,
            type: "tool_result",
            requestId: call.requestId,
            contextId: call.contextId,
            contextRevision: call.contextRevision,
            origin: call.origin,
            result: structuredClone(result) as JsonValue,
          };
          this.#send(response);
        },
        (error: unknown) => {
          if (!this.#isPending(call.requestId, pending)) return;
          const code =
            error instanceof PackToolExecutionError
              ? error.code
              : "EXECUTION_FAILED";
          this.#send(toolError(call, code));
        },
      )
      .finally(() => {
        if (this.#isPending(call.requestId, pending)) {
          this.#pending.delete(call.requestId);
        }
      });
  }

  #isPending(requestId: string, pending: PendingCall): boolean {
    return this.#pending.get(requestId) === pending;
  }
}

function toolError(call: ToolCall, code: ToolError["code"]): ToolError {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_error",
    requestId: call.requestId,
    contextId: call.contextId,
    contextRevision: call.contextRevision,
    origin: call.origin,
    code,
    message: "The compiled capability rejected this request.",
    retryable: false,
  };
}
