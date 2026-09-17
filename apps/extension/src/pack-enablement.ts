import type {
  PageAuthorization,
  PageSenderIdentity,
} from "./page-context-model.js";
import {
  ENABLEMENT_STORAGE_KEY,
  type ChromeActionTab,
  type ChromeEnablementApi,
  type EnabledPackRecord,
  type EnablementState,
  type PackEnablementHooks,
  type PackEnablementRuntime,
  type PackSiteCatalog,
  type PackSiteCatalogFactory,
  type ReviewedPackSite,
} from "./enablement-model.js";
import { showEnablementAction, validActionTabId } from "./enablement-action.js";
import { hasExactHostPermissions } from "./exact-host-permissions.js";
import type { PackContentSource } from "./pack-content-catalog.js";
import {
  createEnablementState,
  EMPTY_ENABLEMENT_STATE,
  parseEnablementState,
  recordKey,
  sameEnablementState,
} from "./enablement-storage.js";
import { recordForSite } from "./reviewed-pack-catalog.js";
import {
  EMPTY_ORIGIN_CONFIG,
  ORIGIN_CONFIG_STORAGE_KEY,
  parseOriginConfigState,
  type OriginConfigState,
} from "./configured-origins.js";

export class PackEnablementController implements PackEnablementRuntime {
  readonly #api: ChromeEnablementApi;
  readonly #createCatalog: PackSiteCatalogFactory;
  #catalog: PackSiteCatalog;
  readonly #content: PackContentSource;
  readonly #fallbackAction: ((tab: ChromeActionTab) => void) | undefined;
  readonly #effective = new Map<string, ReviewedPackSite>();
  readonly #pendingSites = new Set<string>();
  readonly #requested = new Map<string, EnabledPackRecord>();
  #chain = Promise.resolve();
  #hooks: PackEnablementHooks = {};
  #ready = false;
  #started = false;

  readonly authority = {
    authorize: (identity: PageSenderIdentity) => this.#authorize(identity),
  };

  constructor(
    api: ChromeEnablementApi,
    createCatalog: PackSiteCatalogFactory,
    content: PackContentSource,
    fallbackAction?: (tab: ChromeActionTab) => void,
  ) {
    this.#api = api;
    this.#createCatalog = createCatalog;
    this.#catalog = createCatalog(EMPTY_ORIGIN_CONFIG.sites);
    this.#content = content;
    this.#fallbackAction = fallbackAction;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#api.action.onClicked.addListener((tab) => this.#clicked(tab));
    this.#api.lifecycle.onInstalled.addListener(() =>
      this.#invalidateAndReconcile(),
    );
    this.#api.lifecycle.onStartup.addListener(() =>
      this.#invalidateAndReconcile(),
    );
    this.#api.permissions.onAdded.addListener(() =>
      this.#invalidateAndReconcile(),
    );
    this.#api.permissions.onRemoved.addListener(() =>
      this.#invalidateAndReconcile(),
    );
    this.#api.storage.onChanged.addListener((changes, area) => {
      if (
        area === "local" &&
        (Object.hasOwn(changes, ENABLEMENT_STORAGE_KEY) ||
          Object.hasOwn(changes, ORIGIN_CONFIG_STORAGE_KEY))
      ) {
        this.#invalidateAndReconcile();
      }
    });
    this.#queueReconcile();
  }

  setHooks(hooks: PackEnablementHooks): void {
    this.#hooks = hooks;
  }

  async idle(): Promise<void> {
    while (true) {
      const pending = this.#chain;
      await pending;
      if (pending === this.#chain) return;
    }
  }

  #authorize(identity: PageSenderIdentity): PageAuthorization | undefined {
    if (!this.#ready) return undefined;
    const tools = new Set<string>();
    for (const site of this.#catalog.match(identity.url)) {
      if (site.origin !== identity.origin || !this.#effective.has(site.key)) {
        continue;
      }
      for (const tool of site.tools) tools.add(tool);
    }
    return tools.size === 0 ? undefined : Object.freeze({ packTools: tools });
  }

  #clicked(tab: ChromeActionTab): void {
    const tabId = validActionTabId(tab.id);
    const sites =
      typeof tab.url === "string" ? this.#catalog.match(tab.url) : [];
    if (
      tabId !== undefined &&
      sites.length === 0 &&
      this.#fallbackAction !== undefined
    ) {
      this.#fallbackAction(tab);
      return;
    }
    if (tabId === undefined || sites.length !== 1) {
      if (tabId !== undefined) {
        void showEnablementAction(this.#api.action, tabId, "unsupported");
      }
      return;
    }
    const site = sites[0];
    if (site === undefined) return;
    if (!this.#ready) {
      void showEnablementAction(this.#api.action, tabId, "unavailable", site);
      return;
    }
    if (this.#pendingSites.has(site.key)) {
      void showEnablementAction(this.#api.action, tabId, "working", site);
      return;
    }
    if (this.#requested.has(site.key)) {
      this.#pendingSites.add(site.key);
      void showEnablementAction(this.#api.action, tabId, "working", site);
      this.#invalidateOrigin(site.origin);
      this.#enqueue(async () => {
        try {
          await this.#disable(tabId, site);
        } finally {
          this.#pendingSites.delete(site.key);
        }
      });
      return;
    }

    this.#pendingSites.add(site.key);
    void showEnablementAction(this.#api.action, tabId, "working", site);
    let permission: Promise<boolean>;
    try {
      // This call must remain in the synchronous action-listener turn so Chromium
      // can attribute the exact origin request to the user's gesture.
      permission = this.#api.permissions.request({
        origins: site.permissionPatterns,
      });
    } catch {
      this.#pendingSites.delete(site.key);
      void showEnablementAction(this.#api.action, tabId, "denied", site);
      return;
    }
    void permission.then(
      (granted) => {
        if (!granted) {
          this.#pendingSites.delete(site.key);
          void showEnablementAction(this.#api.action, tabId, "denied", site);
          return;
        }
        this.#enqueue(async () => {
          try {
            await this.#enable(tabId, site);
          } finally {
            this.#pendingSites.delete(site.key);
          }
        });
      },
      () => {
        this.#pendingSites.delete(site.key);
        return showEnablementAction(this.#api.action, tabId, "denied", site);
      },
    );
  }

  #queueReconcile(): void {
    this.#enqueue(() => this.#reconcile());
  }

  #invalidateAndReconcile(): void {
    this.#ready = false;
    const origins = new Set(
      [...this.#effective.values()].map((site) => site.origin),
    );
    this.#effective.clear();
    for (const origin of origins) this.#revoke(origin);
    this.#queueReconcile();
  }

  #enqueue(task: () => Promise<void>): void {
    const run = () => task().catch(() => this.#failClosed());
    this.#chain = this.#chain.then(run, run).catch(() => undefined);
  }

  async #enable(tabId: number, site: ReviewedPackSite): Promise<void> {
    const state = await this.#readState();
    const records = new Map(
      state.enabled.map((record) => [recordKey(record), record]),
    );
    records.set(site.key, recordForSite(site));
    await this.#writeState(createEnablementState(records.values()));
    await this.#reconcile();
    await showEnablementAction(
      this.#api.action,
      tabId,
      this.#effective.has(site.key) ? "enabled" : "unavailable",
      site,
    );
  }

  async #disable(tabId: number, site: ReviewedPackSite): Promise<void> {
    const state = await this.#readState();
    const records = state.enabled.filter(
      (record) => recordKey(record) !== site.key,
    );
    await this.#writeState(createEnablementState(records));
    await this.#reconcile();

    await this.#content.removeUnusedPermissions(site.permissionPatterns);
    await this.#reconcile();
    await showEnablementAction(this.#api.action, tabId, "disabled", site);
  }

  async #reconcile(): Promise<void> {
    await this.#api.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    this.#catalog = this.#createCatalog((await this.#readOriginConfig()).sites);
    const stored = await this.#readState();
    const resolved = stored.enabled
      .map((record) => this.#catalog.resolve(record))
      .filter((site): site is ReviewedPackSite => site !== undefined);
    const initiallyGranted = await this.#grantedSites(resolved);
    await this.#reconcileScripts(initiallyGranted);
    const finalSites = await this.#grantedSites(initiallyGranted);
    if (finalSites.length !== initiallyGranted.length) {
      await this.#reconcileScripts(finalSites);
    }
    const finalState = createEnablementState(finalSites.map(recordForSite));
    if (!sameEnablementState(stored, finalState)) {
      await this.#writeState(finalState);
    }
    this.#replaceAuthority(finalSites);
    this.#ready = true;
  }

  async #readOriginConfig(): Promise<OriginConfigState> {
    const container = await this.#api.storage.local.get(
      ORIGIN_CONFIG_STORAGE_KEY,
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      container,
      ORIGIN_CONFIG_STORAGE_KEY,
    );
    if (descriptor === undefined) return EMPTY_ORIGIN_CONFIG;
    const state =
      "value" in descriptor
        ? parseOriginConfigState(descriptor.value)
        : undefined;
    if (state !== undefined) return state;
    await this.#api.storage.local.remove(ORIGIN_CONFIG_STORAGE_KEY);
    return EMPTY_ORIGIN_CONFIG;
  }

  async #readState(): Promise<EnablementState> {
    const container = await this.#api.storage.local.get(ENABLEMENT_STORAGE_KEY);
    const descriptor = Object.getOwnPropertyDescriptor(
      container,
      ENABLEMENT_STORAGE_KEY,
    );
    if (descriptor === undefined) return EMPTY_ENABLEMENT_STATE;
    const state =
      "value" in descriptor
        ? parseEnablementState(descriptor.value)
        : undefined;
    if (state !== undefined) return state;
    await this.#api.storage.local.remove(ENABLEMENT_STORAGE_KEY);
    return EMPTY_ENABLEMENT_STATE;
  }

  async #writeState(state: EnablementState): Promise<void> {
    await this.#api.storage.local.set({ [ENABLEMENT_STORAGE_KEY]: state });
  }

  async #grantedSites(
    candidates: readonly ReviewedPackSite[],
  ): Promise<readonly ReviewedPackSite[]> {
    const grants = new Map<string, boolean>();
    for (const site of candidates) {
      const key = site.permissionPatterns.join("\u0000");
      let granted = grants.get(key);
      if (granted === undefined) {
        granted = await hasExactHostPermissions(
          this.#api.permissions,
          site.permissionPatterns,
        );
        grants.set(key, granted);
      }
    }
    return Object.freeze(
      candidates.filter(
        (site) => grants.get(site.permissionPatterns.join("\u0000")) === true,
      ),
    );
  }

  async #reconcileScripts(sites: readonly ReviewedPackSite[]): Promise<void> {
    await this.#content.replace(
      sites.map((site) => ({
        fingerprint: JSON.stringify([
          "reviewed",
          site.key,
          site.manifest.version,
          site.manifest.digest,
        ]),
        matches: site.scriptMatches,
        origin: site.origin,
        permissionPatterns: site.permissionPatterns,
      })),
    );
  }

  #replaceAuthority(sites: readonly ReviewedPackSite[]): void {
    const previous = fingerprints(this.#effective.values());
    this.#effective.clear();
    this.#requested.clear();
    for (const site of sites) {
      this.#effective.set(site.key, site);
      const record = recordForSite(site);
      this.#requested.set(recordKey(record), record);
    }
    const current = fingerprints(this.#effective.values());
    for (const [origin, fingerprint] of previous) {
      if (current.get(origin) !== fingerprint) this.#revoke(origin);
    }
  }

  async #failClosed(): Promise<void> {
    this.#ready = false;
    const origins = new Set(
      [...this.#effective.values()].map((site) => site.origin),
    );
    this.#effective.clear();
    this.#requested.clear();
    for (const origin of origins) this.#revoke(origin);
    try {
      await this.#content.replace([]);
    } catch {
      // The controller remains unavailable and exposes no page authority.
    }
  }

  #revoke(origin: string): void {
    try {
      this.#hooks.revokeOrigin?.(origin);
    } catch {
      // Revocation state cannot depend on observers.
    }
  }

  #invalidateOrigin(origin: string): void {
    let changed = false;
    for (const [key, site] of [...this.#effective]) {
      if (site.origin === origin) {
        this.#effective.delete(key);
        changed = true;
      }
    }
    if (changed) this.#revoke(origin);
  }
}

function fingerprints(
  sites: Iterable<ReviewedPackSite>,
): ReadonlyMap<string, string> {
  const keys = new Map<string, string[]>();
  for (const site of sites) {
    const originKeys = keys.get(site.origin) ?? [];
    originKeys.push(site.key);
    keys.set(site.origin, originKeys);
  }
  return new Map(
    [...keys].map(([origin, values]) => [origin, values.sort().join("|")]),
  );
}
