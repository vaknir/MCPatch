import {
  MAX_DECLARATIVE_BUNDLE_BYTES,
  canonicalizePageLocation,
  packMatchesLocation,
  parseDeclarativePackBundleContentBytes,
} from "@mcpatch/sdk/runtime";

import type { CompiledPackRuntimeOptions } from "./compiled-pack-validation.js";
import {
  decodeLocalPackBase64,
  isLocalPackMessage,
  isLocalPackRequest,
  localPackFailure as failure,
  localPackSuccess as success,
} from "./local-pack-messages.js";
import {
  LOCAL_CANDIDATE_TTL_MS,
  LOCAL_PACK_STORAGE_KEY,
  LOCAL_PACK_TRUST,
  MAX_LOCAL_CANDIDATES,
  MAX_LOCAL_PACKS,
  type ChromeLocalPackApi,
  type ChromeMessageSender,
  type LocalPackCandidateSummary,
  type LocalPackControllerRuntime,
  type LocalPackRecord,
  type LocalPackRequest,
  type LocalPackResult,
  type LocalPackRuntimeHooks,
  type LocalPackState,
  type LocalPackSummary,
  type ValidatedLocalPack,
} from "./local-pack-model.js";
import { reconcileLocalContentScripts } from "./local-pack-registration.js";
import {
  createLocalPackState,
  EMPTY_LOCAL_PACK_STATE,
  localPackRecord,
  parseLocalPackState,
} from "./local-pack-storage.js";
import {
  LocalBundleError,
  localPackIdentity,
  permissionPatterns,
  recordPermissionPatterns,
  summarizeLocalPack,
  summarizeLocalRecord,
  validateLocalBundle,
} from "./local-pack-validation.js";
import type {
  PageAuthorization,
  PageSenderIdentity,
} from "./page-context-model.js";

interface Candidate {
  readonly token: string;
  readonly expiresAt: number;
  readonly installId: string;
  readonly replacement: boolean;
  readonly pack: ValidatedLocalPack;
}

interface EffectiveRecord {
  readonly record: LocalPackRecord;
  readonly pack: ValidatedLocalPack;
}

export interface LocalPackControllerOptions {
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly reviewedIdentities: ReadonlySet<string>;
  readonly runtime: CompiledPackRuntimeOptions;
}

export class LocalPackController implements LocalPackControllerRuntime {
  readonly #api: ChromeLocalPackApi;
  readonly #options: Required<
    Pick<LocalPackControllerOptions, "now" | "randomId">
  > &
    Omit<LocalPackControllerOptions, "now" | "randomId">;
  readonly #candidates = new Map<string, Candidate>();
  readonly #effective = new Map<string, EffectiveRecord>();
  #chain = Promise.resolve();
  #hooks: LocalPackRuntimeHooks = {};
  #ready = false;
  #started = false;
  #state: LocalPackState = EMPTY_LOCAL_PACK_STATE;

  readonly authority = {
    authorize: (identity: PageSenderIdentity) => this.#authorize(identity),
  };

  constructor(api: ChromeLocalPackApi, options: LocalPackControllerOptions) {
    this.#api = api;
    this.#options = {
      ...options,
      now: options.now ?? (() => Date.now()),
      randomId: options.randomId ?? randomHexId,
    };
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#api.runtime.onMessage.addListener((message, sender, respond) => {
      if (!isLocalPackRequest(message)) {
        if (isLocalPackMessage(message)) respond(failure("INVALID_MESSAGE"));
        return false;
      }
      void this.#message(message, sender).then(respond, () =>
        respond(failure("INVALID_MESSAGE")),
      );
      // Keep the one-time response channel open while validation or storage
      // reconciliation completes in the MV3 service worker.
      return true;
    });
    this.#api.lifecycle.onInstalled.addListener(() =>
      this.#invalidateAndQueue(),
    );
    this.#api.lifecycle.onStartup.addListener(() => this.#invalidateAndQueue());
    this.#api.permissions.onAdded.addListener(() => this.#invalidateAndQueue());
    this.#api.permissions.onRemoved.addListener(() =>
      this.#invalidateAndQueue(),
    );
    this.#api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && Object.hasOwn(changes, LOCAL_PACK_STORAGE_KEY)) {
        this.#invalidateAndQueue();
      }
    });
    this.#queue(() => this.#reconcile());
  }

  setHooks(hooks: LocalPackRuntimeHooks): void {
    this.#hooks = hooks;
  }

  async idle(): Promise<void> {
    while (true) {
      const pending = this.#chain;
      await pending;
      if (pending === this.#chain) return;
    }
  }

  async #message(
    message: LocalPackRequest,
    sender: ChromeMessageSender,
  ): Promise<unknown> {
    if (message.type === "local_pack_content_config") {
      // A persisted document_start registration can wake the worker before its
      // initial storage/permission reconciliation has finished. Keep this
      // one-time response pending so an already-open authorized page does not
      // permanently miss its local pack until the next reload.
      await this.idle();
      return this.#contentConfig(sender);
    }
    if (!this.#developerSender(sender)) return failure("UNAUTHORIZED_SENDER");
    await this.idle();
    switch (message.type) {
      case "local_pack_list":
        return success(this.#listing());
      case "local_pack_set_developer_mode":
        return this.#mutate(() => this.#setDeveloperMode(message.enabled));
      case "local_pack_preview":
        return this.#preview(message.base64);
      case "local_pack_install":
        return this.#mutate(() => this.#install(message.candidateToken));
      case "local_pack_set_enabled":
        return this.#mutate(() =>
          this.#setEnabled(message.installId, message.enabled),
        );
      case "local_pack_uninstall":
        return this.#mutate(() => this.#uninstall(message.installId));
    }
  }

  async #mutate<T>(
    operation: () => Promise<LocalPackResult<T>>,
  ): Promise<LocalPackResult<T>> {
    let result: LocalPackResult<T> = failure("INVALID_MESSAGE");
    this.#queue(async () => {
      result = await operation();
    });
    await this.idle();
    return result;
  }

  async #preview(
    base64: string,
  ): Promise<LocalPackResult<LocalPackCandidateSummary>> {
    if (!this.#state.developerMode) return failure("DEVELOPER_MODE_REQUIRED");
    this.#expireCandidates();
    if (this.#candidates.size >= MAX_LOCAL_CANDIDATES) {
      return failure("TOO_LARGE", "candidates");
    }
    let pack: ValidatedLocalPack;
    try {
      const bytes = decodeLocalPackBase64(base64);
      if (bytes.byteLength > MAX_DECLARATIVE_BUNDLE_BYTES) {
        return failure("TOO_LARGE", "bundle");
      }
      const bundle = parseDeclarativePackBundleContentBytes(bytes);
      pack = await validateLocalBundle(bundle, this.#options.runtime);
    } catch (error) {
      if (error instanceof LocalBundleError) return failure(error.code);
      return failure("INVALID_BUNDLE", "bundle");
    }
    if (this.#options.reviewedIdentities.has(localPackIdentity(pack.bundle))) {
      return failure("COLLISION", "manifest");
    }
    const existing = this.#state.packs.find(
      (record) =>
        localPackIdentity(record.bundle) === localPackIdentity(pack.bundle),
    );
    if (existing === undefined && this.#state.packs.length >= MAX_LOCAL_PACKS) {
      return failure("TOO_LARGE", "packs");
    }
    const token = `candidate.${this.#options.randomId()}`;
    const installId =
      existing?.installId ?? `local.${this.#options.randomId()}`;
    const candidate: Candidate = Object.freeze({
      token,
      installId,
      replacement: existing !== undefined,
      expiresAt: this.#options.now() + LOCAL_CANDIDATE_TTL_MS,
      pack,
    });
    this.#candidates.set(token, candidate);
    return success({
      ...summarizeLocalPack(candidate.pack, false),
      candidateToken: token,
      replacement: candidate.replacement,
    });
  }

  async #install(token: string): Promise<LocalPackResult<LocalPackSummary>> {
    if (!this.#state.developerMode) return failure("DEVELOPER_MODE_REQUIRED");
    this.#expireCandidates();
    const candidate = this.#candidates.get(token);
    if (candidate === undefined) return failure("CANDIDATE_EXPIRED");
    this.#candidates.delete(token);
    const origins = permissionPatterns(candidate.pack.origins);
    if (!(await this.#contains(origins))) return failure("PERMISSION_REQUIRED");

    const records = new Map(
      this.#state.packs.map((record) => [record.installId, record]),
    );
    const replaced = records.get(candidate.installId);
    const replacedPermissions =
      replaced === undefined ? [] : recordPermissionPatterns(replaced);
    if (replaced !== undefined) this.#revokeRecord(replaced);
    records.set(
      candidate.installId,
      localPackRecord(candidate.installId, true, candidate.pack.bundle),
    );
    const state = createLocalPackState(true, records.values());
    if (!(await this.#commit(state))) return failure("STORAGE_INVALID");
    if (replacedPermissions.length > 0) {
      await this.#removeUnusedPermissions(replacedPermissions);
    }
    const installed = this.#state.packs.find(
      (record) => record.installId === candidate.installId,
    );
    return installed === undefined
      ? failure("STORAGE_INVALID")
      : success(
          summarizeLocalPack(
            await this.#validatedRecord(installed),
            true,
            installed.installId,
          ),
        );
  }

  async #setDeveloperMode(
    enabled: boolean,
  ): Promise<LocalPackResult<{ readonly developerMode: boolean }>> {
    if (!enabled) {
      this.#invalidate();
      this.#candidates.clear();
    }
    const records = this.#state.packs.map((record) =>
      enabled
        ? record
        : localPackRecord(record.installId, false, record.bundle),
    );
    const state = createLocalPackState(enabled, records);
    if (!(await this.#commit(state))) return failure("STORAGE_INVALID");
    if (!enabled) await this.#removeUnusedPermissions();
    return success(Object.freeze({ developerMode: enabled }));
  }

  async #setEnabled(
    installId: string,
    enabled: boolean,
  ): Promise<LocalPackResult<LocalPackSummary>> {
    if (!this.#state.developerMode) return failure("DEVELOPER_MODE_REQUIRED");
    const current = this.#state.packs.find(
      (record) => record.installId === installId,
    );
    if (current === undefined) return failure("NOT_FOUND");
    const pack = await this.#validatedRecord(current);
    if (enabled && !(await this.#contains(permissionPatterns(pack.origins)))) {
      return failure("PERMISSION_REQUIRED");
    }
    if (!enabled) this.#revokeRecord(current);
    const records = this.#state.packs.map((record) =>
      record.installId === installId
        ? localPackRecord(record.installId, enabled, record.bundle)
        : record,
    );
    if (!(await this.#commit(createLocalPackState(true, records)))) {
      return failure("STORAGE_INVALID");
    }
    if (!enabled) {
      await this.#removeUnusedPermissions(recordPermissionPatterns(current));
    }
    const updated = this.#state.packs.find(
      (record) => record.installId === installId,
    );
    return updated === undefined
      ? failure("STORAGE_INVALID")
      : success(
          summarizeLocalPack(
            await this.#validatedRecord(updated),
            updated.enabled,
            installId,
          ),
        );
  }

  async #uninstall(
    installId: string,
  ): Promise<LocalPackResult<{ readonly removed: true }>> {
    const current = this.#state.packs.find(
      (record) => record.installId === installId,
    );
    if (current === undefined) return failure("NOT_FOUND");
    const removedPermissions = recordPermissionPatterns(current);
    this.#revokeRecord(current);
    const state = createLocalPackState(
      this.#state.developerMode,
      this.#state.packs.filter((record) => record.installId !== installId),
    );
    if (!(await this.#commit(state))) return failure("STORAGE_INVALID");
    await this.#removeUnusedPermissions(removedPermissions);
    return success(Object.freeze({ removed: true as const }));
  }

  async #commit(state: LocalPackState): Promise<boolean> {
    try {
      await this.#api.storage.local.set({ [LOCAL_PACK_STORAGE_KEY]: state });
      await this.#reconcile();
      return this.#ready;
    } catch {
      await this.#failClosed(true);
      return false;
    }
  }

  async #reconcile(): Promise<void> {
    await this.#api.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    const stored = await this.#readState();
    const valid: Array<{
      readonly record: LocalPackRecord;
      readonly pack: ValidatedLocalPack;
    }> = [];
    try {
      for (const record of stored.packs) {
        const pack = await this.#validatedRecord(record);
        if (
          this.#options.reviewedIdentities.has(localPackIdentity(record.bundle))
        ) {
          throw new Error("reviewed identity collision");
        }
        valid.push({ record, pack });
      }
    } catch {
      await this.#failClosed(true);
      return;
    }
    const effective = stored.developerMode
      ? await this.#granted(valid.filter(({ record }) => record.enabled))
      : [];
    await reconcileLocalContentScripts(
      this.#api.scripting,
      effective.map(({ pack }) => pack),
    );
    const final = await this.#granted(effective);
    const accepted = await this.#hooks.replaceBundles?.(
      final.map(({ pack }) => pack.bundle),
    );
    if (this.#hooks.replaceBundles !== undefined && accepted !== true) {
      await this.#failClosed(true);
      return;
    }
    const finalIds = new Set(final.map(({ record }) => record.installId));
    const normalized = createLocalPackState(
      stored.developerMode,
      stored.packs.map((record) =>
        record.enabled && !finalIds.has(record.installId)
          ? localPackRecord(record.installId, false, record.bundle)
          : record,
      ),
    );
    if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
      await this.#api.storage.local.set({
        [LOCAL_PACK_STORAGE_KEY]: normalized,
      });
    }
    this.#replaceEffective(final);
    this.#state = normalized;
    this.#ready = true;
  }

  async #readState(): Promise<LocalPackState> {
    const container = await this.#api.storage.local.get(LOCAL_PACK_STORAGE_KEY);
    if (!Object.hasOwn(container, LOCAL_PACK_STORAGE_KEY)) {
      return EMPTY_LOCAL_PACK_STATE;
    }
    const parsed = parseLocalPackState(container[LOCAL_PACK_STORAGE_KEY]);
    if (parsed !== undefined) return parsed;
    await this.#api.storage.local.remove(LOCAL_PACK_STORAGE_KEY);
    throw new Error("local pack storage invalid");
  }

  #validatedRecord(record: LocalPackRecord): Promise<ValidatedLocalPack> {
    return validateLocalBundle(record.bundle, this.#options.runtime);
  }

  async #granted<T extends { readonly pack: ValidatedLocalPack }>(
    records: readonly T[],
  ): Promise<readonly T[]> {
    const result: T[] = [];
    for (const record of records) {
      if (await this.#contains(permissionPatterns(record.pack.origins))) {
        result.push(record);
      }
    }
    return Object.freeze(result);
  }

  async #contains(origins: readonly string[]): Promise<boolean> {
    try {
      return await this.#api.permissions.contains({ origins });
    } catch {
      return false;
    }
  }

  #authorize(identityValue: PageSenderIdentity): PageAuthorization | undefined {
    if (!this.#ready) return undefined;
    const page = canonicalizePageLocation(identityValue.url);
    if (!page.ok || page.location.origin !== identityValue.origin)
      return undefined;
    const tools = new Set<string>();
    for (const { pack } of this.#effective.values()) {
      if (!packMatchesLocation(pack.manifest, page.location)) continue;
      for (const tool of pack.manifest.tools) tools.add(tool.name);
    }
    return tools.size === 0 ? undefined : Object.freeze({ packTools: tools });
  }

  async #contentConfig(sender: ChromeMessageSender): Promise<unknown> {
    if (
      !this.#contentSender(sender) ||
      !this.#ready ||
      sender.url === undefined
    ) {
      return failure("UNAUTHORIZED_SENDER");
    }
    const page = canonicalizePageLocation(sender.url);
    if (!page.ok) return failure("UNAUTHORIZED_SENDER");
    const records = [...this.#effective.values()]
      .filter(({ pack }) => packMatchesLocation(pack.manifest, page.location))
      .map(({ record, pack }) => ({
        installId: record.installId,
        trust: LOCAL_PACK_TRUST,
        bundle: pack.bundle,
      }));
    if (records.length === 0) return failure("UNAUTHORIZED_SENDER");
    return success(Object.freeze(records));
  }

  #developerSender(sender: ChromeMessageSender): boolean {
    return (
      sender.id === this.#api.runtime.id &&
      sender.url === this.#api.runtime.getURL("developer.html")
    );
  }

  #contentSender(sender: ChromeMessageSender): boolean {
    return (
      sender.id === this.#api.runtime.id &&
      sender.frameId === 0 &&
      typeof sender.tab?.id === "number" &&
      Number.isSafeInteger(sender.tab.id) &&
      sender.tab.id >= 0 &&
      typeof sender.documentId === "string" &&
      sender.documentId.length > 0 &&
      sender.documentId.length <= 128 &&
      typeof sender.url === "string"
    );
  }

  #listing() {
    return Object.freeze({
      developerMode: this.#state.developerMode,
      packs: Object.freeze(
        this.#state.packs.map((record) => ({
          ...summarizeLocalRecord(record),
          installId: record.installId,
        })),
      ),
    });
  }

  #replaceEffective(
    records: readonly {
      readonly record: LocalPackRecord;
      readonly pack: ValidatedLocalPack;
    }[],
  ): void {
    const previousOrigins = new Set(
      [...this.#effective.values()].flatMap(({ pack }) => pack.origins),
    );
    this.#effective.clear();
    for (const value of records)
      this.#effective.set(value.record.installId, value);
    const nextOrigins = new Set(records.flatMap(({ pack }) => pack.origins));
    for (const origin of previousOrigins) {
      if (!nextOrigins.has(origin)) this.#revoke(origin);
    }
  }

  #revokeRecord(record: LocalPackRecord): void {
    const effective = this.#effective.get(record.installId);
    if (effective === undefined) return;
    this.#effective.delete(record.installId);
    for (const origin of effective.pack.origins) this.#revoke(origin);
  }

  #invalidateAndQueue(): void {
    this.#invalidate();
    this.#queue(() => this.#reconcile());
  }

  #invalidate(): void {
    this.#ready = false;
    const origins = new Set(
      [...this.#effective.values()].flatMap(({ pack }) => pack.origins),
    );
    this.#effective.clear();
    for (const origin of origins) this.#revoke(origin);
  }

  #revoke(origin: string): void {
    try {
      this.#hooks.revokeOrigin?.(origin);
    } catch {
      // Revocation state cannot depend on observers.
    }
  }

  #queue(task: () => Promise<void>): void {
    const run = () => task().catch(() => this.#failClosed(false));
    this.#chain = this.#chain.then(run, run).catch(() => undefined);
  }

  async #failClosed(removeStorage: boolean): Promise<void> {
    this.#invalidate();
    this.#state = EMPTY_LOCAL_PACK_STATE;
    this.#candidates.clear();
    try {
      await this.#hooks.replaceBundles?.([]);
    } catch {
      // Page authority and contexts have already been revoked.
    }
    try {
      await reconcileLocalContentScripts(this.#api.scripting, []);
    } catch {
      // No local authority remains even if script cleanup is delayed.
    }
    if (removeStorage) {
      try {
        await this.#api.storage.local.remove(LOCAL_PACK_STORAGE_KEY);
      } catch {
        // Corrupt storage cannot restore in-memory authority.
      }
    }
  }

  async #removeUnusedPermissions(
    additional: readonly string[] = [],
  ): Promise<void> {
    const needed = new Set(
      this.#state.packs
        .filter((record) => record.enabled)
        .flatMap((record) =>
          record.bundle.manifest.matches.map((match) => `${match.origin}/*`),
        ),
    );
    const candidates = new Set([
      ...additional,
      ...this.#state.packs.flatMap((record) =>
        record.bundle.manifest.matches.map((match) => `${match.origin}/*`),
      ),
    ]);
    const remove = [...candidates].filter((origin) => !needed.has(origin));
    if (remove.length === 0) return;
    try {
      await this.#api.permissions.remove({ origins: remove });
    } catch {
      // Authority is already revoked; browser permission cleanup is best effort.
    }
  }

  #expireCandidates(): void {
    const now = this.#options.now();
    for (const [token, candidate] of this.#candidates) {
      if (candidate.expiresAt <= now) this.#candidates.delete(token);
    }
  }
}

function randomHexId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
