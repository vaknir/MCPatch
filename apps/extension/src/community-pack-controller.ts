import {
  MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
  MAX_DECLARATIVE_BUNDLE_BYTES,
  canonicalizePageLocation,
  packMatchesLocation,
  type CommunityRegistryIndex,
} from "@mcpatch/sdk/runtime";

import {
  RegistryClientError,
  type CommunityRegistryClient,
} from "./community-registry-client.js";
import { hasExactHostPermissions } from "./exact-host-permissions.js";
import { showEnablementAction, validActionTabId } from "./enablement-action.js";
import {
  isCommunityPackMessage,
  isCommunityPackRequest,
  communityPackFailure as failure,
  communityPackSuccess as success,
} from "./community-pack-messages.js";
import {
  artifactRecord,
  selectCommunityCandidate,
  validCommunityActivation,
  withoutInstallState,
} from "./community-pack-lifecycle.js";
import {
  COMMUNITY_CANDIDATE_TTL_MS,
  COMMUNITY_PACK_STORAGE_KEY,
  LEGACY_COMMUNITY_PACK_STORAGE_KEY,
  MAX_COMMUNITY_PACKS,
  type ChromeCommunityPackApi,
  type ChromeMessageSender,
  type CommunityCandidateRecord,
  type CommunityInstalledRecord,
  type CommunityPackAuditEvent,
  type CommunityPackHooks,
  type CommunityPackRequest,
  type CommunityPackResult,
  type CommunityPackReview,
  type CommunityPackRuntime,
  type CommunityPackState,
  type EffectiveCommunityPack,
} from "./community-pack-model.js";
import {
  createCommunityPackState,
  decodeCommunityBase64,
  EMPTY_COMMUNITY_PACK_STATE,
  encodeCommunityBase64,
  parseCommunityPackState,
} from "./community-pack-storage.js";
import {
  communityContentSites,
  communityEntryFor,
  communityIdentity,
  communityPackReview,
} from "./community-pack-projection.js";
import {
  verifyCommunityPackState,
  type VerifiedCommunityPackSnapshot,
} from "./community-pack-state-verifier.js";
import type { DeclarativeDefinitionSource } from "./declarative-definition-catalog.js";
import type { PackContentSource } from "./pack-content-catalog.js";
import type {
  PageAuthorization,
  PageSenderIdentity,
} from "./page-context-model.js";

export interface CommunityPackControllerOptions {
  readonly client: CommunityRegistryClient;
  readonly content: PackContentSource;
  readonly definitions: DeclarativeDefinitionSource;
  readonly reviewedIdentities: ReadonlySet<string>;
  readonly now?: () => number;
  readonly randomId?: () => string;
}

export class CommunityPackController implements CommunityPackRuntime {
  readonly #api: ChromeCommunityPackApi;
  readonly #options: Required<
    Pick<CommunityPackControllerOptions, "now" | "randomId">
  > &
    Omit<CommunityPackControllerOptions, "now" | "randomId">;
  readonly #effective = new Map<string, EffectiveCommunityPack>();
  #chain = Promise.resolve();
  #hooks: CommunityPackHooks = {};
  #ready = false;
  #started = false;
  #state: CommunityPackState = EMPTY_COMMUNITY_PACK_STATE;

  readonly authority = {
    authorize: (identity: PageSenderIdentity) => this.#authorize(identity),
  };

  constructor(
    api: ChromeCommunityPackApi,
    options: CommunityPackControllerOptions,
  ) {
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
      if (!isCommunityPackRequest(message)) {
        if (isCommunityPackMessage(message))
          respond(failure("INVALID_MESSAGE"));
        return false;
      }
      void this.#message(message, sender).then(respond, () =>
        respond(failure("INVALID_MESSAGE")),
      );
      return true;
    });
    this.#api.lifecycle.onInstalled.addListener(() =>
      this.#invalidateAndQueue(true),
    );
    this.#api.lifecycle.onStartup.addListener(() =>
      this.#invalidateAndQueue(true),
    );
    this.#api.permissions.onAdded.addListener(() => this.#invalidateAndQueue());
    this.#api.permissions.onRemoved.addListener(() =>
      this.#invalidateAndQueue(),
    );
    this.#api.storage.onChanged.addListener((changes, area) => {
      if (
        area === "local" &&
        Object.hasOwn(changes, COMMUNITY_PACK_STORAGE_KEY)
      ) {
        this.#invalidateAndQueue();
      }
    });
    this.#queue(() => this.#reconcileAndRefresh());
  }

  setHooks(hooks: CommunityPackHooks): void {
    this.#hooks = hooks;
  }

  handleAction(tab: { readonly id?: number; readonly url?: string }): void {
    const tabId = validActionTabId(tab.id);
    const page =
      typeof tab.url === "string"
        ? canonicalizePageLocation(tab.url)
        : undefined;
    if (tabId === undefined || page === undefined || !page.ok) {
      if (tabId !== undefined) {
        void showEnablementAction(this.#api.action, tabId, "unsupported");
      }
      return;
    }
    void showEnablementAction(this.#api.action, tabId, "working");
    this.#queue(async () => {
      try {
        await this.#discover(tabId, tab.url as string);
      } catch {
        await showEnablementAction(this.#api.action, tabId, "unavailable");
      }
    });
  }

  async idle(): Promise<void> {
    while (true) {
      const pending = this.#chain;
      await pending;
      if (pending === this.#chain) return;
    }
  }

  async #message(
    message: CommunityPackRequest,
    sender: ChromeMessageSender,
  ): Promise<unknown> {
    await this.idle();
    if (message.type === "community_pack_content_config") {
      return this.#contentConfig(sender);
    }
    if (!this.#reviewSender(sender, message.candidateToken)) {
      return failure("UNAUTHORIZED_SENDER");
    }
    if (message.type === "community_pack_review_get") {
      return this.#review(message.candidateToken);
    }
    return this.#mutate(() => this.#install(message.candidateToken));
  }

  async #mutate<T>(
    operation: () => Promise<CommunityPackResult<T>>,
  ): Promise<CommunityPackResult<T>> {
    let result: CommunityPackResult<T> = failure("INVALID_MESSAGE");
    this.#queue(async () => {
      result = await operation();
    });
    await this.idle();
    return result;
  }

  async #discover(tabId: number, url: string): Promise<void> {
    await this.#reconcile();
    const now = new Date(this.#options.now());
    let index: CommunityRegistryIndex;
    let freshness: "cached" | "online" = "online";
    try {
      index = await this.#options.client.index(
        this.#state.highWaterSequence,
        now,
      );
      if (
        index.publicationSequence === this.#state.highWaterSequence &&
        this.#state.indexBase64 !== undefined
      ) {
        const current = await this.#options.client.indexFromCache(
          decodeCommunityBase64(
            this.#state.indexBase64,
            MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
          ),
          this.#state.highWaterSequence,
          now,
        );
        if (current.signature.signature !== index.signature.signature) {
          throw new Error("registry sequence equivocation");
        }
      }
      if (!(await this.#adoptIndex(index, now))) {
        throw new Error("registry index could not be activated");
      }
    } catch (error) {
      if (
        !(error instanceof RegistryClientError) ||
        error.code !== "NETWORK_REJECTED"
      ) {
        throw error;
      }
      const cached = await verifyCommunityPackState(
        this.#state,
        now,
        this.#options.client,
        this.#options.reviewedIdentities,
      );
      if (cached.index === undefined) {
        throw new Error("registry unavailable", { cause: error });
      }
      index = cached.index;
      freshness = "cached";
    }
    const page = canonicalizePageLocation(url);
    if (!page.ok) throw new Error("page unavailable");
    const selection = selectCommunityCandidate(
      index,
      this.#state.installed,
      page.location.origin,
    );
    if (selection.status !== "candidate") {
      await showEnablementAction(this.#api.action, tabId, selection.status);
      return;
    }
    const { entry, existing, kind } = selection;
    if (this.#options.reviewedIdentities.has(communityIdentity(entry))) {
      throw new Error("reviewed identity collision");
    }
    const verified =
      kind === "rollback" && existing?.previous !== undefined
        ? await this.#options.client.verifyPackBytes(
            index,
            entry,
            decodeCommunityBase64(
              existing.previous.bundleBase64,
              MAX_DECLARATIVE_BUNDLE_BYTES,
            ),
            now,
          )
        : await this.#options.client.pack(index, entry, now);
    if (!packMatchesLocation(verified.content.manifest, page.location)) {
      await showEnablementAction(this.#api.action, tabId, "unsupported");
      return;
    }
    if (
      existing === undefined &&
      this.#state.installed.length >= MAX_COMMUNITY_PACKS
    ) {
      throw new Error("community pack limit reached");
    }
    const token = `candidate.${this.#options.randomId()}`;
    const bundleBase64 =
      kind === "rollback" && existing?.previous !== undefined
        ? existing.previous.bundleBase64
        : encodeCommunityBase64(
            new TextEncoder().encode(JSON.stringify(verified.bundle)),
          );
    const candidate: CommunityCandidateRecord = Object.freeze({
      candidateToken: token,
      kind,
      installId: existing?.installId ?? `registry.${this.#options.randomId()}`,
      expiresAt: this.#options.now() + COMMUNITY_CANDIDATE_TTL_MS,
      indexSequence: index.publicationSequence,
      ...artifactRecord(entry, verified.content, bundleBase64),
      targetUrl: url,
      freshness,
    });
    const state = createCommunityPackState({
      highWaterSequence: index.publicationSequence,
      indexBase64: encodeCommunityBase64(
        new TextEncoder().encode(JSON.stringify(index)),
      ),
      indexVerifiedAt: now.toISOString(),
      installed: this.#state.installed,
      candidate,
    });
    if (!(await this.#commit(state))) throw new Error("candidate rejected");
    this.#audit(
      candidate,
      kind === "rollback" ? "ROLLBACK_STAGED" : "CANDIDATE_STAGED",
      "CANDIDATE",
    );
    const reviewUrl = new URL(
      this.#api.runtime.getURL("community-review.html"),
    );
    reviewUrl.searchParams.set("candidate", token);
    await this.#api.tabs.create({ url: reviewUrl.href, active: true });
    await showEnablementAction(this.#api.action, tabId, "disabled");
  }

  async #adoptIndex(
    index: CommunityRegistryIndex,
    now: Date,
  ): Promise<boolean> {
    for (const record of this.#state.installed) {
      const entry = communityEntryFor(index, record);
      if (record.enabled && entry?.revocation.status === "REVOKED") {
        this.#audit(record, "REVOKED", "REVOKED");
      }
    }
    const state = createCommunityPackState({
      highWaterSequence: index.publicationSequence,
      indexBase64: encodeCommunityBase64(
        new TextEncoder().encode(JSON.stringify(index)),
      ),
      indexVerifiedAt: now.toISOString(),
      installed: this.#state.installed,
    });
    return this.#commit(state);
  }

  async #reconcileAndRefresh(): Promise<void> {
    await this.#reconcile();
    if (!this.#ready || this.#state.installed.length === 0) return;
    const now = new Date(this.#options.now());
    try {
      const index = await this.#options.client.index(
        this.#state.highWaterSequence,
        now,
      );
      if (
        index.publicationSequence === this.#state.highWaterSequence &&
        this.#state.indexBase64 !== undefined
      ) {
        const current = await this.#options.client.indexFromCache(
          decodeCommunityBase64(
            this.#state.indexBase64,
            MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
          ),
          this.#state.highWaterSequence,
          now,
        );
        if (current.signature.signature !== index.signature.signature) return;
      }
      await this.#adoptIndex(index, now);
    } catch {
      // A failed refresh cannot replace or extend cached authority. Its signed
      // freshness deadline still governs the already reconciled artifact.
    }
  }

  async #review(
    token: string,
  ): Promise<CommunityPackResult<CommunityPackReview>> {
    const snapshot = await verifyCommunityPackState(
      this.#state,
      new Date(this.#options.now()),
      this.#options.client,
      this.#options.reviewedIdentities,
    );
    const candidate = snapshot.candidate;
    if (
      candidate === undefined ||
      candidate.record.candidateToken !== token ||
      candidate.record.expiresAt <= this.#options.now() ||
      snapshot.index === undefined
    ) {
      return failure("CANDIDATE_EXPIRED");
    }
    const current = this.#state.installed.find(
      (record) =>
        communityIdentity(record) === communityIdentity(candidate.entry),
    );
    return success(communityPackReview(candidate, snapshot.index, current));
  }

  async #install(
    token: string,
  ): Promise<CommunityPackResult<{ readonly installed: true }>> {
    const snapshot = await verifyCommunityPackState(
      this.#state,
      new Date(this.#options.now()),
      this.#options.client,
      this.#options.reviewedIdentities,
    );
    const candidate = snapshot.candidate;
    if (
      candidate === undefined ||
      candidate.record.candidateToken !== token ||
      candidate.record.expiresAt <= this.#options.now()
    ) {
      return failure("CANDIDATE_EXPIRED");
    }
    const patterns = candidate.entry.origins.map((origin) => `${origin}/*`);
    if (!(await hasExactHostPermissions(this.#api.permissions, patterns))) {
      return failure("PERMISSION_REQUIRED");
    }
    const current = this.#state.installed.find(
      (record) =>
        communityIdentity(record) === communityIdentity(candidate.entry),
    );
    if (!validCommunityActivation(candidate.record, current)) {
      return failure("COLLISION");
    }
    const previousState = this.#state;
    const records = new Map(
      this.#state.installed.map((record) => [
        communityIdentity(record),
        record,
      ]),
    );
    const artifact = artifactRecord(
      candidate.entry,
      candidate.bundle,
      candidate.record.bundleBase64,
    );
    records.set(
      communityIdentity(candidate.entry),
      Object.freeze({
        installId: candidate.record.installId,
        enabled: true,
        ...artifact,
        ...(candidate.record.kind === "update" && current !== undefined
          ? { previous: withoutInstallState(current) }
          : {}),
      }),
    );
    const state = createCommunityPackState({
      highWaterSequence: this.#state.highWaterSequence,
      ...(this.#state.indexBase64 === undefined
        ? {}
        : {
            indexBase64: this.#state.indexBase64,
            indexVerifiedAt: this.#state.indexVerifiedAt,
          }),
      installed: records.values(),
    });
    if (!(await this.#commit(state))) {
      await this.#restore(previousState);
      return failure("STORAGE_INVALID");
    }
    this.#audit(artifact, "ACTIVATED", "ACTIVE");
    if (current !== undefined) {
      await this.#options.content.removeUnusedPermissions(
        current.origins.map((origin) => `${origin}/*`),
      );
    }
    return success(Object.freeze({ installed: true as const }));
  }

  async #restore(state: CommunityPackState): Promise<void> {
    try {
      await this.#api.storage.local.set({
        [COMMUNITY_PACK_STORAGE_KEY]: state,
      });
      await this.#reconcile();
      if (!this.#ready) throw new Error("community state restore failed");
    } catch {
      await this.#failClosed(true);
    }
  }

  async #commit(state: CommunityPackState): Promise<boolean> {
    try {
      await this.#api.storage.local.set({
        [COMMUNITY_PACK_STORAGE_KEY]: state,
      });
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
    let snapshot: VerifiedCommunityPackSnapshot;
    try {
      snapshot = await verifyCommunityPackState(
        stored,
        new Date(this.#options.now()),
        this.#options.client,
        this.#options.reviewedIdentities,
      );
    } catch {
      await this.#failClosed(true);
      return;
    }
    const requested = snapshot.installed.filter(({ record }) => record.enabled);
    const effective: EffectiveCommunityPack[] = [];
    for (const pack of requested) {
      if (
        await hasExactHostPermissions(
          this.#api.permissions,
          pack.entry.origins.map((origin) => `${origin}/*`),
        )
      ) {
        effective.push(pack);
      }
    }
    await this.#options.content.replace(communityContentSites(effective));
    const final: EffectiveCommunityPack[] = [];
    for (const pack of effective) {
      if (
        await hasExactHostPermissions(
          this.#api.permissions,
          pack.entry.origins.map((origin) => `${origin}/*`),
        )
      ) {
        final.push(pack);
      }
    }
    if (final.length !== effective.length) {
      await this.#options.content.replace(communityContentSites(final));
    }
    if (
      !(await this.#options.definitions.replace(
        final.map(({ bundle }) => bundle),
      ))
    ) {
      throw new Error("community definitions rejected");
    }
    const finalIds = new Set(final.map(({ record }) => record.installId));
    const normalized = createCommunityPackState({
      highWaterSequence: stored.highWaterSequence,
      ...(stored.indexBase64 === undefined
        ? {}
        : {
            indexBase64: stored.indexBase64,
            indexVerifiedAt: stored.indexVerifiedAt,
          }),
      installed: stored.installed.map((record) =>
        record.enabled && !finalIds.has(record.installId)
          ? Object.freeze({ ...record, enabled: false })
          : record,
      ),
      ...(snapshot.candidate === undefined
        ? {}
        : { candidate: snapshot.candidate.record }),
    });
    if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
      await this.#api.storage.local.set({
        [COMMUNITY_PACK_STORAGE_KEY]: normalized,
      });
    }
    this.#replaceEffective(final);
    this.#state = normalized;
    this.#ready = true;
  }

  async #readState(): Promise<CommunityPackState> {
    const container = await this.#api.storage.local.get(
      COMMUNITY_PACK_STORAGE_KEY,
    );
    if (!Object.hasOwn(container, COMMUNITY_PACK_STORAGE_KEY)) {
      await this.#api.storage.local.remove(LEGACY_COMMUNITY_PACK_STORAGE_KEY);
      return EMPTY_COMMUNITY_PACK_STATE;
    }
    const state = parseCommunityPackState(
      container[COMMUNITY_PACK_STORAGE_KEY],
    );
    if (state !== undefined) return state;
    await this.#api.storage.local.remove(COMMUNITY_PACK_STORAGE_KEY);
    throw new Error("community pack storage invalid");
  }

  #authorize(identityValue: PageSenderIdentity): PageAuthorization | undefined {
    if (!this.#ready) return undefined;
    const page = canonicalizePageLocation(identityValue.url);
    if (!page.ok || page.location.origin !== identityValue.origin)
      return undefined;
    const tools = new Set<string>();
    for (const { bundle } of this.#effective.values()) {
      if (!packMatchesLocation(bundle.manifest, page.location)) continue;
      for (const tool of bundle.manifest.tools) tools.add(tool.name);
    }
    return tools.size === 0 ? undefined : Object.freeze({ packTools: tools });
  }

  #contentConfig(sender: ChromeMessageSender): unknown {
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
      .filter(({ bundle }) =>
        packMatchesLocation(bundle.manifest, page.location),
      )
      .map(({ record, entry, bundle }) => ({
        installId: record.installId,
        trust: entry.trust,
        bundle,
      }));
    return records.length === 0
      ? failure("UNAUTHORIZED_SENDER")
      : success(records);
  }

  #reviewSender(sender: ChromeMessageSender, token: string): boolean {
    if (sender.id !== this.#api.runtime.id || typeof sender.url !== "string") {
      return false;
    }
    try {
      const url = new URL(sender.url);
      const expected = new URL(
        this.#api.runtime.getURL("community-review.html"),
      );
      return (
        url.protocol === expected.protocol &&
        url.host === expected.host &&
        url.pathname === expected.pathname &&
        url.searchParams.get("candidate") === token &&
        [...url.searchParams.keys()].length === 1 &&
        url.hash === ""
      );
    } catch {
      return false;
    }
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

  #replaceEffective(records: readonly EffectiveCommunityPack[]): void {
    const removed = [...this.#effective.values()].filter(
      ({ record }) =>
        !records.some(
          (candidate) => candidate.record.installId === record.installId,
        ),
    );
    const previous = new Set(
      [...this.#effective.values()].flatMap(({ entry }) => entry.origins),
    );
    this.#effective.clear();
    for (const pack of records)
      this.#effective.set(pack.record.installId, pack);
    const next = new Set(records.flatMap(({ entry }) => entry.origins));
    for (const origin of previous) {
      if (!next.has(origin)) this.#revoke(origin);
    }
    for (const { record } of removed) {
      this.#audit(record, "REVOKED", "REVOKED");
    }
  }

  #invalidateAndQueue(refresh = false): void {
    this.#invalidate();
    this.#queue(() =>
      refresh ? this.#reconcileAndRefresh() : this.#reconcile(),
    );
  }

  #invalidate(): void {
    this.#ready = false;
    const origins = new Set(
      [...this.#effective.values()].flatMap(({ entry }) => entry.origins),
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

  #audit(
    artifact: Pick<
      CommunityInstalledRecord,
      "publisher" | "id" | "version" | "digest"
    >,
    type: CommunityPackAuditEvent["type"],
    status: CommunityPackAuditEvent["status"],
  ): void {
    try {
      this.#hooks.audit?.(
        Object.freeze({
          eventVersion: 1,
          type,
          publisher: artifact.publisher,
          id: artifact.id,
          version: artifact.version,
          digest: artifact.digest,
          status,
        }),
      );
    } catch {
      // Audit observers cannot grant, retain, or revoke authority.
    }
  }

  #queue(task: () => Promise<void>): void {
    const run = () => task().catch(() => this.#failClosed(false));
    this.#chain = this.#chain.then(run, run).catch(() => undefined);
  }

  async #failClosed(removeStorage: boolean): Promise<void> {
    this.#invalidate();
    this.#state = EMPTY_COMMUNITY_PACK_STATE;
    try {
      await this.#options.definitions.replace([]);
    } catch {
      // Definition authority has already been removed in memory.
    }
    try {
      await this.#options.content.replace([]);
    } catch {
      // Aggregate page authority remains closed.
    }
    if (removeStorage) {
      try {
        await this.#api.storage.local.remove(COMMUNITY_PACK_STORAGE_KEY);
      } catch {
        // Corrupt storage cannot restore in-memory authority.
      }
    }
  }
}

function randomHexId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
