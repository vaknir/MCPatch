import type {
  DeclarativePackBundleContent,
  PackManifest,
  PackPermission,
  PackRisk,
} from "@mcpatch/sdk/runtime";

import type { ChromeEvent, ChromeRuntimeLifecycleApi } from "./lifecycle.js";
import type {
  ChromePermissionsApi,
  ChromeScriptingApi,
  ChromeStorageApi,
} from "./enablement-model.js";
import type { PageAuthority } from "./page-context-model.js";

export const LOCAL_PACK_STORAGE_KEY = "mcpatch.local-packs.v1";
export const LOCAL_PACK_STATE_VERSION = 1 as const;
export const LOCAL_PACK_TRUST = "UNSIGNED_LOCAL_DEVELOPMENT" as const;
export const MAX_LOCAL_PACKS = 4;
export const MAX_LOCAL_CANDIDATES = 4;
export const LOCAL_CANDIDATE_TTL_MS = 5 * 60 * 1_000;

export interface LocalPackRecord {
  readonly installId: string;
  readonly trust: typeof LOCAL_PACK_TRUST;
  readonly enabled: boolean;
  readonly bundle: DeclarativePackBundleContent;
}

export interface LocalPackState {
  readonly stateVersion: typeof LOCAL_PACK_STATE_VERSION;
  readonly developerMode: boolean;
  readonly packs: readonly LocalPackRecord[];
}

export interface LocalPackToolSummary {
  readonly name: string;
  readonly description: string;
  readonly risk: PackRisk;
  readonly permissions: readonly PackPermission[];
}

export interface LocalPackSummary {
  readonly installId?: string;
  readonly publisher: string;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly trust: typeof LOCAL_PACK_TRUST;
  readonly origins: readonly string[];
  readonly tools: readonly LocalPackToolSummary[];
  readonly enabled: boolean;
}

export interface LocalPackCandidateSummary extends LocalPackSummary {
  readonly candidateToken: string;
  readonly replacement: boolean;
}

export type LocalPackErrorCode =
  | "CANDIDATE_EXPIRED"
  | "COLLISION"
  | "DEVELOPER_MODE_REQUIRED"
  | "DIGEST_MISMATCH"
  | "INCOMPATIBLE"
  | "INVALID_BUNDLE"
  | "INVALID_MESSAGE"
  | "NOT_FOUND"
  | "PERMISSION_REQUIRED"
  | "STORAGE_INVALID"
  | "TOO_LARGE"
  | "UNAUTHORIZED_SENDER";

export type LocalPackResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{
      readonly ok: false;
      readonly error: Readonly<{
        readonly code: LocalPackErrorCode;
        readonly field?: string;
      }>;
    }>;

export type LocalPackDeveloperRequest =
  | Readonly<{ readonly type: "local_pack_list" }>
  | Readonly<{
      readonly type: "local_pack_set_developer_mode";
      readonly enabled: boolean;
    }>
  | Readonly<{
      readonly type: "local_pack_preview";
      readonly base64: string;
    }>
  | Readonly<{
      readonly type: "local_pack_install";
      readonly candidateToken: string;
    }>
  | Readonly<{
      readonly type: "local_pack_set_enabled";
      readonly installId: string;
      readonly enabled: boolean;
    }>
  | Readonly<{
      readonly type: "local_pack_uninstall";
      readonly installId: string;
    }>;

export type LocalPackContentRequest = Readonly<{
  readonly type: "local_pack_content_config";
}>;

export type LocalPackRequest =
  LocalPackDeveloperRequest | LocalPackContentRequest;

export interface ChromeMessageSender {
  readonly id?: string;
  readonly url?: string;
  readonly documentId?: string;
  readonly frameId?: number;
  readonly tab?: { readonly id?: number };
}

export interface ChromeRuntimeMessageApi {
  readonly id: string;
  readonly onMessage: ChromeEvent<
    [unknown, ChromeMessageSender, (response: unknown) => void]
  >;
  getURL(path: string): string;
}

export interface ChromeLocalPackApi {
  readonly lifecycle: ChromeRuntimeLifecycleApi;
  readonly permissions: ChromePermissionsApi;
  readonly runtime: ChromeRuntimeMessageApi;
  readonly scripting: ChromeScriptingApi;
  readonly storage: ChromeStorageApi;
}

export interface LocalPackRuntimeHooks {
  readonly replaceBundles?: (
    bundles: readonly DeclarativePackBundleContent[],
  ) => Promise<boolean>;
  readonly revokeOrigin?: (origin: string) => void;
}

export interface LocalPackControllerRuntime {
  readonly authority: PageAuthority;
  idle(): Promise<void>;
  setHooks(hooks: LocalPackRuntimeHooks): void;
  start(): void;
}

export interface ValidatedLocalPack {
  readonly bundle: DeclarativePackBundleContent;
  readonly manifest: PackManifest;
  readonly origins: readonly string[];
}
