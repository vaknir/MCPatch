import type {
  JsonObject,
  Permission,
  Risk,
  VersionedMessage,
} from "./common.js";

export interface PackReference {
  publisher: string;
  id: string;
  version: string;
  digest: string;
}

interface CapabilityBase {
  name: string;
  title?: string;
  description: string;
  origin: string;
  risk: Risk;
  permissions: Permission[];
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
}

export interface NativeWebMcpCapability extends CapabilityBase {
  source: "native_webmcp";
  pack?: never;
}

export interface PackCapability extends CapabilityBase {
  source: "pack";
  pack: PackReference;
}

export type Capability = NativeWebMcpCapability | PackCapability;

export interface CapabilitySnapshot extends VersionedMessage {
  type: "capability_snapshot";
  contextId: string;
  contextRevision: number;
  origin: string;
  capabilities: Capability[];
}

export type ContextClosedReason =
  "navigation" | "tab_closed" | "pack_disabled" | "disconnected";

export interface ContextClosed extends VersionedMessage {
  type: "context_closed";
  contextId: string;
  contextRevision: number;
  reason: ContextClosedReason;
}
