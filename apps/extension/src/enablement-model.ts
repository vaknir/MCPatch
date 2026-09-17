import type { PackManifest } from "@mcpatch/sdk/runtime";

import type { ChromeEvent, ChromeRuntimeLifecycleApi } from "./lifecycle.js";
import type { PageAuthority } from "./page-context-model.js";

export const ENABLEMENT_STORAGE_KEY = "mcpatch.enablement.v1";
export const ENABLEMENT_STATE_VERSION = 1 as const;
export const CONTENT_SCRIPT_FILE = "content-script.js";

export interface ReviewedPackSite {
  readonly key: string;
  readonly manifest: PackManifest;
  readonly origin: string;
  readonly permissionPattern: string;
  readonly permissionPatterns: readonly string[];
  /**
   * Where the content script is registered: the manifest's own path rules,
   * not the whole origin. Host permissions stay origin-granular because
   * Chrome grants them that way; this bounds where code runs.
   */
  readonly scriptMatches: readonly string[];
  readonly tools: ReadonlySet<string>;
}

export interface EnabledPackRecord {
  readonly publisher: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly origin: string;
}

export interface EnablementState {
  readonly stateVersion: typeof ENABLEMENT_STATE_VERSION;
  readonly enabled: readonly EnabledPackRecord[];
}

export interface PackSiteCatalog {
  readonly sites: readonly ReviewedPackSite[];
  match(url: string): readonly ReviewedPackSite[];
  resolve(record: EnabledPackRecord): ReviewedPackSite | undefined;
}

export interface ChromeActionTab {
  readonly id?: number;
  readonly url?: string;
}

export interface ChromeActionApi {
  readonly onClicked: ChromeEvent<[ChromeActionTab]>;
  setBadgeBackgroundColor(details: {
    readonly color: string;
    readonly tabId: number;
  }): Promise<void>;
  setBadgeText(details: {
    readonly tabId: number;
    readonly text: string;
  }): Promise<void>;
  setTitle(details: {
    readonly tabId: number;
    readonly title: string;
  }): Promise<void>;
}

export interface ChromePermissionsApi {
  readonly onAdded: ChromeEvent<[ChromePermissionSet]>;
  readonly onRemoved: ChromeEvent<[ChromePermissionSet]>;
  getAll(): Promise<ChromePermissionSet>;
  remove(permissions: ChromePermissionSet): Promise<boolean>;
  request(permissions: ChromePermissionSet): Promise<boolean>;
}

export interface ChromePermissionSet {
  readonly origins?: readonly string[];
  readonly permissions?: readonly string[];
}

export interface ChromeRegisteredContentScript {
  readonly id: string;
  readonly matches: readonly string[];
  readonly js: readonly string[];
  readonly allFrames: false;
  readonly persistAcrossSessions: true;
  readonly runAt: "document_start";
  readonly world: "ISOLATED";
}

export interface ChromeScriptingApi {
  getRegisteredContentScripts(): Promise<
    readonly ChromeRegisteredContentScript[]
  >;
  registerContentScripts(
    scripts: readonly ChromeRegisteredContentScript[],
  ): Promise<void>;
  unregisterContentScripts(filter: {
    readonly ids: readonly string[];
  }): Promise<void>;
}

export interface ChromeStorageChange {
  readonly newValue?: unknown;
  readonly oldValue?: unknown;
}

export interface ChromeStorageAreaApi {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(items: Readonly<Record<string, unknown>>): Promise<void>;
  setAccessLevel(settings: {
    readonly accessLevel: "TRUSTED_CONTEXTS";
  }): Promise<void>;
}

export interface ChromeStorageApi {
  readonly local: ChromeStorageAreaApi;
  readonly onChanged: ChromeEvent<
    [
      Record<string, ChromeStorageChange>,
      "local" | "managed" | "session" | "sync",
    ]
  >;
}

export interface ChromeEnablementApi {
  readonly action: ChromeActionApi;
  readonly lifecycle: ChromeRuntimeLifecycleApi;
  readonly permissions: ChromePermissionsApi;
  readonly scripting: ChromeScriptingApi;
  readonly storage: ChromeStorageApi;
}

export interface PackEnablementHooks {
  readonly revokeOrigin?: (origin: string) => void;
}

export interface PackEnablementRuntime {
  readonly authority: PageAuthority;
  idle(): Promise<void>;
  setHooks(hooks: PackEnablementHooks): void;
  start(): void;
}
