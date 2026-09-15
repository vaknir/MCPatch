import type { JsonObject, JsonValue } from "@mcpatch/protocol";

import {
  encodeWorkerToPageMessage,
  PAGE_PROTOCOL_VERSION,
  type PageToolError,
  type PageToolResult,
  type WorkerToPageMessage,
} from "./page-channel.js";
import { PageInvocationError } from "./page-context-model.js";
import type {
  OwnedPagePort,
  PendingInvocation,
} from "./page-context-session.js";
import type { SessionScheduler } from "./native-session-model.js";

const MAX_PENDING_CALLS = 64;

export class PageInvocationRouter {
  #requestSequence = 0;

  constructor(
    readonly scheduler: SessionScheduler,
    readonly callTimeoutMs: number,
  ) {}

  invoke(
    session: OwnedPagePort | undefined,
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    if (
      session?.binding === undefined ||
      session.phase !== "ready" ||
      !session.capabilities.has(tool) ||
      session.pending.size >= MAX_PENDING_CALLS
    ) {
      return Promise.reject(new PageInvocationError("TOOL_UNAVAILABLE"));
    }
    if (signal.aborted) {
      return Promise.reject(new PageInvocationError("CANCELLED"));
    }
    const requestId = `page-request.${++this.#requestSequence}`;
    const binding = session.binding;
    return new Promise<JsonValue>((resolve, reject) => {
      const onAbort = () => this.#cancel(session, requestId, "CANCELLED", true);
      const timer = this.scheduler.schedule(
        () => this.#cancel(session, requestId, "TIMEOUT", true),
        this.callTimeoutMs,
      );
      session.pending.set(requestId, {
        resolve,
        reject,
        timer,
        tool,
        signal,
        onAbort,
      });
      signal.addEventListener("abort", onAbort, { once: true });
      if (
        !send(session, {
          pageProtocolVersion: PAGE_PROTOCOL_VERSION,
          type: "page_tool_call",
          ...binding,
          requestId,
          tool,
          args,
        })
      ) {
        this.#cancel(session, requestId, "TOOL_UNAVAILABLE", false);
      }
    });
  }

  complete(
    session: OwnedPagePort,
    message: PageToolResult | PageToolError,
  ): boolean {
    const pending = session.pending.get(message.requestId);
    if (pending === undefined || pending.tool !== message.tool) return false;
    this.#remove(session, message.requestId, pending);
    if (message.type === "page_tool_result") pending.resolve(message.result);
    else pending.reject(new PageInvocationError(message.code));
    return true;
  }

  cancelAll(session: OwnedPagePort): void {
    for (const [requestId, pending] of [...session.pending]) {
      this.#remove(session, requestId, pending);
      pending.reject(new PageInvocationError("CANCELLED"));
    }
  }

  #cancel(
    session: OwnedPagePort,
    requestId: string,
    code: "CANCELLED" | "TIMEOUT" | "TOOL_UNAVAILABLE",
    notify: boolean,
  ): void {
    const pending = session.pending.get(requestId);
    if (pending === undefined) return;
    this.#remove(session, requestId, pending);
    if (notify && session.binding !== undefined) {
      send(session, {
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_cancel",
        ...session.binding,
        requestId,
        tool: pending.tool,
      });
    }
    pending.reject(new PageInvocationError(code));
  }

  #remove(
    session: OwnedPagePort,
    requestId: string,
    pending: PendingInvocation,
  ): void {
    session.pending.delete(requestId);
    this.scheduler.cancel(pending.timer);
    pending.signal.removeEventListener("abort", pending.onAbort);
  }
}

export function send(
  session: OwnedPagePort,
  message: WorkerToPageMessage,
): boolean {
  try {
    session.port.postMessage(encodeWorkerToPageMessage(message));
    return true;
  } catch {
    return false;
  }
}
