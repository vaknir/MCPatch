import type {
  CommunityPackTrust,
  CommunityRegistryPackEntry,
  DeclarativePackBundleContent,
  PackCompatibility,
  PackNetworkPolicy,
  PackPermission,
  PackRisk,
} from "@mcpatch/sdk/runtime";

import type { ChromeEvent, ChromeRuntimeLifecycleApi } from "./lifecycle.js";
import type {
  ChromeActionApi,
  ChromePermissionSet,
  ChromePermissionsApi,
  ChromeStorageApi,
} from "./enablement-model.js";
import type {
  ChromeMessageSender,
  ChromeRuntimeMessageApi,
} from "./local-pack-model.js";
import type { PageAuthority } from "./page-context-model.js";

export const LEGACY_COMMUNITY_PACK_STORAGE_KEY = "mcpatch.community-packs.v1";
export const COMMUNITY_PACK_STORAGE_KEY = "mcpatch.community-packs.v2";
export const COMMUNITY_PACK_STATE_VERSION = 2 as const;
export const MAX_COMMUNITY_PACKS = 4;
export const COMMUNITY_CANDIDATE_TTL_MS = 5 * 60 * 1_000;

export interface CommunityArtifactRecord {
  readonly publisher: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly publisherKey: string;
  readonly trust: CommunityPackTrust;
  readonly operationsVersion: 1;
  readonly origins: readonly string[];
  readonly bundleBase64: string;
}

export interface CommunityInstalledRecord extends CommunityArtifactRecord {
  readonly installId: string;
  readonly enabled: boolean;
  readonly previous?: CommunityArtifactRecord;
}

export type CommunityCandidateKind = "install" | "rollback" | "update";

export interface CommunityCandidateRecord extends CommunityArtifactRecord {
  readonly candidateToken: string;
  readonly kind: CommunityCandidateKind;
  readonly installId: string;
  readonly expiresAt: number;
  readonly indexSequence: number;
  readonly targetUrl: string;
  readonly freshness: "cached" | "online";
}

export interface CommunityPackState {
  readonly stateVersion: typeof COMMUNITY_PACK_STATE_VERSION;
  readonly highWaterSequence: number;
  readonly indexBase64?: string;
  readonly indexVerifiedAt?: string;
  readonly installed: readonly CommunityInstalledRecord[];
  readonly candidate?: CommunityCandidateRecord;
}

export interface CommunityPackReviewTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly risk: PackRisk;
  readonly permissions: readonly PackPermission[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export interface CommunityPackReview {
  readonly candidateToken: string;
  readonly kind: CommunityCandidateKind;
  readonly current?: Readonly<{
    readonly version: string;
    readonly digest: string;
  }>;
  readonly publisher: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly digest: string;
  readonly trust: CommunityPackTrust;
  readonly origins: readonly string[];
  readonly paths: readonly Readonly<{
    readonly origin: string;
    readonly rules: readonly string[];
  }>[];
  readonly tools: readonly CommunityPackReviewTool[];
  readonly compatibility: PackCompatibility;
  readonly networkPolicy: PackNetworkPolicy;
  readonly verification: CommunityRegistryPackEntry["verification"];
  readonly publisherPublicKey: string;
  readonly registryKeyId: string;
  readonly registrySequence: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly freshness: "cached" | "online";
}

export type CommunityPackErrorCode =
  | "AMBIGUOUS"
  | "CANDIDATE_EXPIRED"
  | "COLLISION"
  | "INCOMPATIBLE"
  | "INVALID_MESSAGE"
  | "NETWORK_REJECTED"
  | "NOT_FOUND"
  | "PACK_REVOKED"
  | "PERMISSION_REQUIRED"
  | "STORAGE_INVALID"
  | "UNAUTHORIZED_SENDER";

export type CommunityPackResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{
      readonly ok: false;
      readonly error: Readonly<{ readonly code: CommunityPackErrorCode }>;
    }>;

export type CommunityPackRequest =
  | Readonly<{
      readonly type: "community_pack_review_get";
      readonly candidateToken: string;
    }>
  | Readonly<{
      readonly type: "community_pack_install";
      readonly candidateToken: string;
    }>
  | Readonly<{ readonly type: "community_pack_content_config" }>;

export interface ChromeCommunityTabsApi {
  create(details: {
    readonly url: string;
    readonly active: true;
  }): Promise<unknown>;
}

export interface ChromeCommunityPackApi {
  readonly action: ChromeActionApi;
  readonly lifecycle: ChromeRuntimeLifecycleApi;
  readonly permissions: ChromePermissionsApi;
  readonly runtime: ChromeRuntimeMessageApi;
  readonly storage: ChromeStorageApi;
  readonly tabs: ChromeCommunityTabsApi;
}

export interface CommunityPackHooks {
  readonly revokeOrigin?: (origin: string) => void;
  readonly audit?: (event: CommunityPackAuditEvent) => void;
}

export type CommunityPackAuditEvent = Readonly<{
  readonly eventVersion: 1;
  readonly type:
    | "ACTIVATED"
    | "CANDIDATE_STAGED"
    | "DISABLED"
    | "REVOKED"
    | "ROLLBACK_STAGED";
  readonly publisher: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly status: "ACTIVE" | "CANDIDATE" | "DENIED" | "REVOKED";
}>;

export interface EffectiveCommunityPack {
  readonly record: CommunityInstalledRecord;
  readonly entry: CommunityRegistryPackEntry;
  readonly bundle: DeclarativePackBundleContent;
}

export interface CommunityPackRuntime {
  readonly authority: PageAuthority;
  handleAction(tab: { readonly id?: number; readonly url?: string }): void;
  idle(): Promise<void>;
  setHooks(hooks: CommunityPackHooks): void;
  start(): void;
}

export type { ChromeEvent, ChromeMessageSender, ChromePermissionSet };
