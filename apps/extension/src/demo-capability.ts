import {
  PROTOCOL_VERSION,
  type CapabilitySnapshot,
  type ContextClosed,
  type Message,
  type ToolCall,
  type ToolError,
  type ToolResult,
} from "@mcpatch/protocol";

import type { BridgeApplicationMessage } from "./native-session-model.js";

export const DEMO_CONTEXT_ID = "mcpatch.demo";
export const DEMO_ORIGIN = "https://demo.mcpatch.invalid";
export const DEMO_TOOL_NAME = "mcpatch.demo.status";

const DEMO_PACK = {
  publisher: "mcpatch",
  id: "builtin-demo",
  version: "0.1.0",
  // Stable demo identity, not a marketplace signature. The code is bundled in the extension.
  digest:
    "sha256:879486d0000d36f06d47958b5285dec823c7805112a4bd086962c20e1d54fb78",
} as const;

type MessageSender = (message: Message) => boolean;

export class DemoCapabilityRuntime {
  readonly #send: MessageSender;
  #currentRevision: number | undefined;
  #lastRevision = 0;

  constructor(send: MessageSender) {
    this.#send = send;
  }

  publish(): void {
    const contextRevision = ++this.#lastRevision;
    this.#currentRevision = contextRevision;
    this.#sendRequired(snapshot(contextRevision));
  }

  close(): void {
    const contextRevision = this.#currentRevision;
    this.#currentRevision = undefined;
    if (contextRevision === undefined) return;

    const closed: ContextClosed = {
      protocolVersion: PROTOCOL_VERSION,
      type: "context_closed",
      contextId: DEMO_CONTEXT_ID,
      contextRevision,
      reason: "disconnected",
    };
    this.#send(closed);
  }

  handle(message: BridgeApplicationMessage): boolean {
    if (message.type === "cancel") return true;
    if (message.type !== "tool_call") return false;

    const errorCode = this.#validateCall(message);
    if (errorCode !== undefined) {
      this.#sendRequired(toolError(message, errorCode));
      return true;
    }

    const result: ToolResult = {
      protocolVersion: PROTOCOL_VERSION,
      type: "tool_result",
      requestId: message.requestId,
      contextId: message.contextId,
      contextRevision: message.contextRevision,
      origin: message.origin,
      result: { status: "ready" },
    };
    this.#sendRequired(result);
    return true;
  }

  #validateCall(call: ToolCall): ToolError["code"] | undefined {
    if (
      call.contextId !== DEMO_CONTEXT_ID ||
      call.contextRevision !== this.#currentRevision
    ) {
      return "CONTEXT_NOT_FOUND";
    }
    if (call.origin !== DEMO_ORIGIN) return "ORIGIN_MISMATCH";
    if (call.tool !== DEMO_TOOL_NAME) return "TOOL_NOT_FOUND";
    if (Object.keys(call.args).length !== 0) return "INVALID_REQUEST";
    return undefined;
  }

  #sendRequired(message: Message): void {
    if (!this.#send(message)) {
      throw new Error("native session rejected a demo capability message");
    }
  }
}

function snapshot(contextRevision: number): CapabilitySnapshot {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "capability_snapshot",
    contextId: DEMO_CONTEXT_ID,
    contextRevision,
    origin: DEMO_ORIGIN,
    capabilities: [
      {
        name: DEMO_TOOL_NAME,
        title: "MCPatch demo status",
        description: "Return deterministic MCPatch demo runtime status.",
        origin: DEMO_ORIGIN,
        source: "pack",
        pack: DEMO_PACK,
        risk: "read",
        permissions: ["READ"],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          maxProperties: 0,
          properties: {},
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { const: "ready", type: "string" } },
        },
      },
    ],
  };
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
    message: "The demo capability rejected this request.",
    retryable: false,
  };
}
