import type {
  JsonObject,
  PackToolHandler,
  PackToolManifest,
} from "@mcpatch/sdk/runtime";
import type { Message } from "@mcpatch/protocol";

export type MessageSender = (message: Message) => boolean;

export interface NativeRuntimeTool {
  readonly tool: PackToolManifest;
  readonly execute: PackToolHandler;
}

export interface PackRuntimeContext {
  readonly contextId: string;
  readonly url: string;
  readonly native: readonly NativeRuntimeTool[];
}

export type ContextActivationResult =
  | {
      readonly ok: true;
      readonly published: boolean;
      readonly contextRevision: number;
    }
  | {
      readonly ok: false;
      readonly code: "RESOLUTION_REJECTED" | "SNAPSHOT_REJECTED";
    };

export interface RuntimeRoute {
  readonly execute: PackToolHandler;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
}

export interface ActiveContext {
  readonly contextId: string;
  readonly contextRevision: number;
  readonly origin: string;
  readonly routes: ReadonlyMap<string, RuntimeRoute>;
}
