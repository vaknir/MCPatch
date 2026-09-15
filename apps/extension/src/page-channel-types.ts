import type { JsonObject, JsonValue } from "@mcpatch/protocol";

export const PAGE_PROTOCOL_VERSION = 1 as const;
export const MAX_PAGE_FRAME_BYTES = 256 * 1024;
export const MAX_PAGE_CAPABILITIES = 128;

export interface PageImplementation {
  readonly name: string;
  readonly version: string;
}

export interface PageBinding {
  readonly channelId: string;
  readonly contextId: string;
  readonly contextRevision: number;
  readonly tabId: number;
  readonly documentId: string;
  readonly origin: string;
}

export interface PageHello {
  readonly pageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly type: "page_hello";
  readonly supportedPageProtocolVersions: readonly [
    typeof PAGE_PROTOCOL_VERSION,
  ];
  readonly implementation: PageImplementation;
}

export interface PageHelloAck extends PageBinding {
  readonly pageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly type: "page_hello_ack";
  readonly selectedPageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly implementation: PageImplementation;
}

export interface PagePackCapability {
  readonly source: "pack";
  readonly name: string;
}

export interface PageNativeCapability {
  readonly source: "native_webmcp";
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: {
    readonly readOnlyHint: true;
    readonly consequentialHint: false;
    readonly untrustedContentHint: true;
  };
}

export type PageCapability = PagePackCapability | PageNativeCapability;

export interface PageCapabilitySnapshot extends PageBinding {
  readonly pageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly type: "page_capability_snapshot";
  readonly snapshotRevision: number;
  readonly capabilities: readonly PageCapability[];
}

export interface PageToolCall extends PageBinding {
  readonly pageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly type: "page_tool_call";
  readonly requestId: string;
  readonly tool: string;
  readonly args: JsonObject;
}

export interface PageToolResult extends PageBinding {
  readonly pageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly type: "page_tool_result";
  readonly requestId: string;
  readonly tool: string;
  readonly result: JsonValue;
}

export type PageToolErrorCode =
  "CANCELLED" | "EXECUTION_FAILED" | "RESULT_INVALID" | "TOOL_UNAVAILABLE";

export interface PageToolError extends PageBinding {
  readonly pageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly type: "page_tool_error";
  readonly requestId: string;
  readonly tool: string;
  readonly code: PageToolErrorCode;
}

export interface PageCancel extends PageBinding {
  readonly pageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly type: "page_cancel";
  readonly requestId: string;
  readonly tool: string;
}

export type PageContextClosedReason =
  "adapter_unavailable" | "document_unloading";

export interface PageContextClosed extends PageBinding {
  readonly pageProtocolVersion: typeof PAGE_PROTOCOL_VERSION;
  readonly type: "page_context_closed";
  readonly reason: PageContextClosedReason;
}

export type PageToWorkerMessage =
  | PageCapabilitySnapshot
  | PageContextClosed
  | PageHello
  | PageToolError
  | PageToolResult;

export type WorkerToPageMessage = PageCancel | PageHelloAck | PageToolCall;

export type PageChannelMessage = PageToWorkerMessage | WorkerToPageMessage;

export type PageProtocolValidationCode =
  | "DUPLICATE_FIELD"
  | "INVALID_IDENTIFIER"
  | "INVALID_ORIGIN"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "LIMIT_EXCEEDED"
  | "MALFORMED_JSON"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_VERSION"
  | "WRONG_DIRECTION";

export class PageProtocolValidationError extends Error {
  readonly code: PageProtocolValidationCode;
  readonly field: string;

  constructor(code: PageProtocolValidationCode, field: string) {
    super(`page protocol validation failed: ${code} at ${field}`);
    this.name = "PageProtocolValidationError";
    this.code = code;
    this.field = field;
  }
}
