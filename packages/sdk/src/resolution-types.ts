import type { PackManifest, PackToolManifest } from "./types.js";

export interface CanonicalPageLocation {
  readonly origin: string;
  readonly path: string;
}

export interface CapabilityResolutionIssue {
  readonly code:
    | "INVALID_CONTEXT"
    | "INVALID_LOCATION"
    | "INVALID_NATIVE_CAPABILITY"
    | "INVALID_PACK"
    | "LIMIT_EXCEEDED";
  readonly field: string;
}

export type PageLocationResult =
  | {
      readonly ok: true;
      readonly location: CanonicalPageLocation;
    }
  | {
      readonly ok: false;
      readonly issue: CapabilityResolutionIssue;
    };

export interface NativeCapabilityCandidate<TNative> {
  readonly name: string;
  readonly value: TNative;
}

export interface EnabledPackCandidate<TPack> {
  readonly manifest: PackManifest;
  readonly value: TPack;
}

export interface ContextCapabilityResolutionInput<TNative, TPack> {
  readonly contextId: string;
  readonly contextRevision: number;
  readonly url: string;
  readonly native: readonly NativeCapabilityCandidate<TNative>[];
  readonly packs: readonly EnabledPackCandidate<TPack>[];
}

export interface CapabilityContextBinding {
  readonly contextId: string;
  readonly contextRevision: number;
  readonly origin: string;
}

export interface PackIdentity {
  readonly publisher: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export interface ResolvedNativeCapability<TNative> {
  readonly binding: CapabilityContextBinding;
  readonly name: string;
  readonly source: "native_webmcp";
  readonly value: TNative;
}

export interface ResolvedPackCapability<TPack> {
  readonly binding: CapabilityContextBinding;
  readonly name: string;
  readonly source: "pack";
  readonly pack: PackIdentity;
  readonly tool: PackToolManifest;
  readonly value: TPack;
}

export type ResolvedCapability<TNative, TPack> =
  ResolvedNativeCapability<TNative> | ResolvedPackCapability<TPack>;

export interface CapabilityCollision {
  readonly name: string;
  readonly nativeCount: number;
  readonly outcome: "hidden" | "native";
  readonly packs: readonly PackIdentity[];
  readonly reason: "ambiguous_native" | "ambiguous_pack" | "native_precedence";
}

export interface ContextCapabilityResolution<TNative, TPack> {
  readonly binding: CapabilityContextBinding;
  readonly capabilities: readonly ResolvedCapability<TNative, TPack>[];
  readonly collisions: readonly CapabilityCollision[];
}

export type ContextCapabilityResolutionResult<TNative, TPack> =
  | {
      readonly ok: true;
      readonly resolution: ContextCapabilityResolution<TNative, TPack>;
    }
  | {
      readonly ok: false;
      readonly issue: CapabilityResolutionIssue;
    };
