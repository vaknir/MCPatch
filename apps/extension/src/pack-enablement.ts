import type {
  PageAuthorization,
  PageSenderIdentity,
} from "./page-context-model.js";
import {
  ENABLEMENT_STORAGE_KEY,
  REGISTRATION_PREFIX,
  type ChromeActionTab,
  type ChromeEnablementApi,
  type EnabledPackRecord,
  type EnablementState,
  type PackEnablementHooks,
  type PackEnablementRuntime,
  type PackSiteCatalog,
  type ReviewedPackSite,
} from "./enablement-model.js";
import { showEnablementAction, validActionTabId } from "./enablement-action.js";
import { reconcileContentScripts } from "./enablement-registration.js";
import {
  createEnablementState,
  EMPTY_ENABLEMENT_STATE,
  parseEnablementState,
  recordKey,
  sameEnablementState,
} from "./enablement-storage.js";
import { recordForSite } from "./reviewed-pack-catalog.js";

export class PackEnablementController implements PackEnablementRuntime {
  readonly #api: ChromeEnablementApi;
  readonly #catalog: PackSiteCatalog;
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

  constructor(api: ChromeEnablementApi, catalog: PackSiteCatalog) {
    this.#api = api;
    this.#catalog = catalog;
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
      if (area === "local" && Object.hasOwn(changes, ENABLEMENT_STORAGE_KEY)) {
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

    const needed = this.#neededPermissionPatterns();
    const removable = site.permissionPatterns.filter(
      (pattern) => !needed.has(pattern),
    );
    if (removable.length > 0) {
      try {
        await this.#api.permissions.remove({
          origins: removable,
        });
      } catch {
        // Local state and script authority are already revoked. Permission cleanup
        // is best-effort and is reconciled again below.
      }
      await this.#reconcile();
    }
    await showEnablementAction(this.#api.action, tabId, "disabled", site);
  }

  async #reconcile(): Promise<void> {
    await this.#api.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
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
        granted = await this.#api.permissions.contains({
          origins: site.permissionPatterns,
        });
        grants.set(key, granted);
      }
    }
    return Object.freeze(
      candidates.filter(
        (site) => grants.get(site.permissionPatterns.join("\u0000")) === true,
      ),
    );
  }

  #neededPermissionPatterns(): ReadonlySet<string> {
    const patterns = new Set<string>();
    for (const record of this.#requested.values()) {
      const site = this.#catalog.resolve(record);
      if (site !== undefined) {
        for (const pattern of site.permissionPatterns) patterns.add(pattern);
      }
    }
    return patterns;
  }

  async #reconcileScripts(sites: readonly ReviewedPackSite[]): Promise<void> {
    await reconcileContentScripts(
      this.#api.scripting,
      sites,
      this.#effective.values(),
      (origin) => this.#invalidateOrigin(origin),
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
      const current = await this.#api.scripting.getRegisteredContentScripts();
      const ids = current
        .filter((script) => script.id.startsWith(REGISTRATION_PREFIX))
        .map((script) => script.id);
      if (ids.length > 0) {
        await this.#api.scripting.unregisterContentScripts({ ids });
      }
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
