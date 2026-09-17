import { describe, expect, it, vi } from "vitest";

import type {
  CommunityRegistryIndex,
  CommunityRegistryPackEntry,
  DeclarativePackBundle,
  DeclarativePackBundleContent,
} from "@mcpatch/sdk/runtime";

import { CommunityPackController } from "../src/community-pack-controller.js";
import type { CommunityRegistryClient } from "../src/community-registry-client.js";
import { RegistryClientError } from "../src/community-registry-client.js";
import {
  COMMUNITY_PACK_STORAGE_KEY,
  type ChromeCommunityPackApi,
  type ChromeMessageSender,
  type CommunityPackResult,
  type CommunityPackReview,
} from "../src/community-pack-model.js";
import {
  EMPTY_COMMUNITY_PACK_STATE,
  parseCommunityPackState,
} from "../src/community-pack-storage.js";
import { PackContentCatalog } from "../src/pack-content-catalog.js";
import type { DeclarativeDefinitionSource } from "../src/declarative-definition-catalog.js";
import { FakeEnablementApi } from "./support/enablement.js";
import {
  LOCAL_ORIGIN,
  LOCAL_TOOL,
  LOCAL_URL,
  localBundle,
} from "./support/local-pack.js";
import { FakeChromeEvent } from "./support/native-session.js";
import type { ChromeRuntimeMessageApi } from "../src/local-pack-model.js";

const NOW = Date.parse("2026-09-17T00:00:00.000Z");

describe("reviewed community pack controller", () => {
  it("stages review, requires an exact grant, installs, and serves the page", async () => {
    const state = await setup();
    await settle(state.controller);

    state.controller.handleAction({ id: 7, url: LOCAL_URL });
    await settle(state.controller);

    expect(state.api.tabs.created).toHaveLength(1);
    const reviewUrl = state.api.tabs.created[0];
    if (reviewUrl === undefined) throw new Error("review URL missing");
    const token = new URL(reviewUrl).searchParams.get("candidate");
    if (token === null) throw new Error("candidate missing");
    const review = await state.message<CommunityPackReview>(
      { type: "community_pack_review_get", candidateToken: token },
      reviewSender(reviewUrl),
    );
    expect(review).toMatchObject({
      ok: true,
      value: {
        publisher: "example",
        id: "read-page",
        trust: "REVIEWED_COMMUNITY",
        freshness: "online",
        origins: [LOCAL_ORIGIN],
        tools: [{ name: LOCAL_TOOL, risk: "read", permissions: ["READ"] }],
      },
    });

    expect(
      await state.message(
        { type: "community_pack_install", candidateToken: token },
        reviewSender(reviewUrl),
      ),
    ).toMatchObject({ ok: false, error: { code: "PERMISSION_REQUIRED" } });

    state.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
    expect(
      await state.message(
        { type: "community_pack_install", candidateToken: token },
        reviewSender(reviewUrl),
      ),
    ).toEqual({ ok: true, value: { installed: true } });
    await settle(state.controller);

    expect(state.api.scripting.registrations.size).toBe(1);
    expect(state.definitions.replace).toHaveBeenLastCalledWith([state.bundle]);
    expect(state.controller.authority.authorize(pageIdentity())).toEqual({
      packTools: new Set([LOCAL_TOOL]),
    });
    expect(
      await state.message(
        { type: "community_pack_content_config" },
        contentSender(),
      ),
    ).toMatchObject({
      ok: true,
      value: [{ trust: "REVIEWED_COMMUNITY", bundle: state.bundle }],
    });
    expect(stored(state.api).installed).toEqual([
      expect.objectContaining({ version: state.bundle.manifest.version }),
    ]);
    expect(stored(state.api).candidate).toBeUndefined();
  });

  it("does not accept a broad covering grant", async () => {
    const state = await stagedSetup();
    state.api.permissions.inventoryOrigins = ["https://*/*"];

    expect(
      await state.message(
        {
          type: "community_pack_install",
          candidateToken: state.token,
        },
        reviewSender(state.reviewUrl),
      ),
    ).toMatchObject({ ok: false, error: { code: "PERMISSION_REQUIRED" } });
    expect(stored(state.api).installed).toEqual([]);
  });

  it("restores a fresh verified artifact offline without network access", async () => {
    const first = await installedSetup();
    const restoredApi = new FakeCommunityPackApi();
    restoredApi.storage.data[COMMUNITY_PACK_STORAGE_KEY] = structuredClone(
      first.api.storage.data[COMMUNITY_PACK_STORAGE_KEY],
    );
    restoredApi.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
    const offline = first.client;
    offline.failNetwork = true;
    const content = new PackContentCatalog(
      restoredApi.scripting,
      restoredApi.permissions,
    );
    const definitions = fakeDefinitions();
    const restored = new CommunityPackController(restoredApi, {
      client: offline as unknown as CommunityRegistryClient,
      content: content.createSource("community"),
      definitions,
      reviewedIdentities: new Set(),
      now: () => NOW,
      randomId: () => "f".repeat(32),
    });

    restored.start();
    await settle(restored);

    expect(offline.indexCalls).toBe(1);
    expect(restored.authority.authorize(pageIdentity())).toEqual({
      packTools: new Set([LOCAL_TOOL]),
    });
    expect(definitions.replace).toHaveBeenLastCalledWith([first.bundle]);
  });

  it("does not downgrade an invalid online index to the cached index", async () => {
    const state = await stagedSetup();
    state.api.tabs.created.length = 0;
    state.client.rejectIndex = true;

    state.controller.handleAction({ id: 7, url: LOCAL_URL });
    await settle(state.controller);

    expect(state.api.tabs.created).toEqual([]);
    expect(stored(state.api).candidate?.candidateToken).toBe(state.token);
  });

  it("fails closed when dynamic content registration fails", async () => {
    const state = await stagedSetup();
    state.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
    state.api.scripting.throwRegister = true;

    await expect(
      state.message(
        { type: "community_pack_install", candidateToken: state.token },
        reviewSender(state.reviewUrl),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORAGE_INVALID" },
    });
    expect(
      state.controller.authority.authorize(pageIdentity()),
    ).toBeUndefined();
    expect(state.api.scripting.registrations.size).toBe(0);
    expect(state.api.storage.data).not.toHaveProperty(
      COMMUNITY_PACK_STORAGE_KEY,
    );
  });

  it("fails closed when cached freshness expires", async () => {
    const first = await installedSetup();
    const api = new FakeCommunityPackApi();
    api.storage.data[COMMUNITY_PACK_STORAGE_KEY] = structuredClone(
      first.api.storage.data[COMMUNITY_PACK_STORAGE_KEY],
    );
    api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
    first.client.failCache = true;
    const content = new PackContentCatalog(api.scripting, api.permissions);
    const controller = new CommunityPackController(api, {
      client: first.client as unknown as CommunityRegistryClient,
      content: content.createSource("community"),
      definitions: fakeDefinitions(),
      reviewedIdentities: new Set(),
      now: () => Date.parse("2026-09-25T00:00:00.000Z"),
    });

    controller.start();
    await settle(controller);

    expect(controller.authority.authorize(pageIdentity())).toBeUndefined();
    expect(api.storage.data).not.toHaveProperty(COMMUNITY_PACK_STORAGE_KEY);
    expect(api.scripting.registrations.size).toBe(0);
  });

  it("fails closed on ambiguous cached matches and reviewed identity collisions", async () => {
    const ambiguous = await setup({ duplicateCandidate: true });
    await settle(ambiguous.controller);
    ambiguous.controller.handleAction({ id: 7, url: LOCAL_URL });
    await settle(ambiguous.controller);
    expect(ambiguous.api.tabs.created).toEqual([]);
    expect(ambiguous.api.scripting.registrations.size).toBe(0);

    const collision = await setup({
      reviewedIdentities: new Set(["example/read-page"]),
    });
    await settle(collision.controller);
    collision.controller.handleAction({ id: 7, url: LOCAL_URL });
    await settle(collision.controller);
    expect(collision.api.tabs.created).toEqual([]);
  });

  it("rejects hostile extension senders and malformed messages", async () => {
    const state = await stagedSetup();
    expect(
      await state.message(
        {
          type: "community_pack_review_get",
          candidateToken: state.token,
        },
        {
          id: state.api.runtime.id,
          url: state.api.runtime.getURL("developer.html"),
        },
      ),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED_SENDER" } });
    expect(
      await state.message({
        type: "community_pack_install",
        candidateToken: state.token,
        extra: "private-value",
      }),
    ).toEqual({ ok: false, error: { code: "INVALID_MESSAGE" } });
  });
});

interface SetupOptions {
  readonly duplicateCandidate?: boolean;
  readonly reviewedIdentities?: ReadonlySet<string>;
}

async function setup(options: SetupOptions = {}) {
  const api = new FakeCommunityPackApi();
  const bundle = await localBundle();
  const client = new FakeRegistryClient(
    bundle,
    options.duplicateCandidate ?? false,
  );
  const content = new PackContentCatalog(api.scripting, api.permissions);
  const definitions = fakeDefinitions();
  let random = 0;
  const controller = new CommunityPackController(api, {
    client: client as unknown as CommunityRegistryClient,
    content: content.createSource("community"),
    definitions,
    reviewedIdentities: options.reviewedIdentities ?? new Set(),
    now: () => NOW,
    randomId: () => (++random).toString(16).padStart(32, "0"),
  });
  controller.start();
  return {
    api,
    bundle,
    client,
    controller,
    definitions,
    message: <T = unknown>(message: unknown, sender?: ChromeMessageSender) =>
      api.message<T>(message, sender),
  };
}

async function stagedSetup() {
  const state = await setup();
  await settle(state.controller);
  state.controller.handleAction({ id: 7, url: LOCAL_URL });
  await settle(state.controller);
  const reviewUrl = state.api.tabs.created[0];
  if (reviewUrl === undefined) throw new Error("review URL missing");
  const token = new URL(reviewUrl).searchParams.get("candidate");
  if (token === null) throw new Error("candidate missing");
  return { ...state, reviewUrl, token };
}

async function installedSetup() {
  const state = await stagedSetup();
  state.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
  await state.message(
    { type: "community_pack_install", candidateToken: state.token },
    reviewSender(state.reviewUrl),
  );
  await settle(state.controller);
  return state;
}

class FakeRegistryClient {
  readonly bundle: DeclarativePackBundleContent;
  readonly fullBundle: DeclarativePackBundle;
  readonly indexValue: CommunityRegistryIndex;
  failCache = false;
  failNetwork = false;
  rejectIndex = false;
  indexCalls = 0;

  constructor(bundle: DeclarativePackBundleContent, duplicate: boolean) {
    this.bundle = bundle;
    this.fullBundle = {
      ...bundle,
      publisherSignature: {
        signatureVersion: 1,
        algorithm: "Ed25519",
        publisher: bundle.manifest.publisher,
        keyId: `ed25519:${bundle.manifest.publisher}:sha256:${"1".repeat(64)}`,
        publicKey: "A".repeat(43),
        signature: "A".repeat(86),
      },
    };
    const entry = registryEntry(bundle);
    this.indexValue = {
      indexVersion: 1,
      registryId: "mcpatch-registry",
      publicationSequence: 7,
      issuedAt: "2026-09-16T23:00:00.000Z",
      expiresAt: "2026-09-24T23:00:00.000Z",
      packs: duplicate
        ? [entry, { ...entry, id: "other-pack", bundlePath: "/other.mcpack" }]
        : [entry],
      signature: {
        signatureVersion: 1,
        algorithm: "Ed25519",
        keyId: `ed25519:mcpatch-registry:sha256:${"2".repeat(64)}`,
        signature: "B".repeat(86),
      },
    };
  }

  async index(): Promise<CommunityRegistryIndex> {
    this.indexCalls += 1;
    if (this.failNetwork) throw new RegistryClientError("NETWORK_REJECTED");
    if (this.rejectIndex) throw new RegistryClientError("INDEX_REJECTED");
    return this.indexValue;
  }

  async indexFromCache(): Promise<CommunityRegistryIndex> {
    if (this.failCache) throw new Error("stale");
    return this.indexValue;
  }

  async pack(
    _index: CommunityRegistryIndex,
    entry: CommunityRegistryPackEntry,
  ) {
    return {
      bundle: this.fullBundle,
      content: this.bundle,
      entry,
      indexSequence: 7,
    };
  }

  async verifyPackBytes(
    _index: CommunityRegistryIndex,
    entry: CommunityRegistryPackEntry,
  ) {
    return {
      bundle: this.fullBundle,
      content: this.bundle,
      entry,
      indexSequence: 7,
    };
  }
}

function registryEntry(
  bundle: DeclarativePackBundleContent,
): CommunityRegistryPackEntry {
  const manifest = bundle.manifest;
  return {
    publisher: manifest.publisher,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    bundleDigest: manifest.digest,
    bundlePath: "/v1/bundles/example/read-page/bundle.mcpack",
    publisherKey: "A".repeat(43),
    trust: "REVIEWED_COMMUNITY",
    origins: [LOCAL_ORIGIN],
    tools: manifest.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      permissions: tool.permissions,
    })),
    compatibility: manifest.compatibility,
    networkPolicy: manifest.networkPolicy,
    verification: {
      verifiedAt: "2026-09-16T22:00:00.000Z",
      fixtureTestsPassed: 1,
      fixtureTestsTotal: 1,
      sourceCommit: bundle.metadata.sourceCommit ?? "a".repeat(40),
    },
    revocation: { status: "ACTIVE" },
    attestation: {
      attestationVersion: 1,
      registryId: "mcpatch-registry",
      keyId: `ed25519:mcpatch-registry:sha256:${"2".repeat(64)}`,
      publisher: manifest.publisher,
      id: manifest.id,
      version: manifest.version,
      bundleDigest: manifest.digest,
      publicationSequence: 7,
      reviewState: "REVIEWED_COMMUNITY",
      issuedAt: "2026-09-16T23:00:00.000Z",
      expiresAt: "2026-09-24T23:00:00.000Z",
      signature: "B".repeat(86),
    },
  };
}

function fakeDefinitions(): DeclarativeDefinitionSource & {
  readonly replace: ReturnType<typeof vi.fn>;
} {
  return { replace: vi.fn(async () => true) };
}

class FakeCommunityPackApi
  extends FakeEnablementApi
  implements ChromeCommunityPackApi
{
  readonly runtime = new FakeMessageRuntime();
  readonly tabs = {
    created: [] as string[],
    create: async ({
      url,
    }: {
      readonly url: string;
      readonly active: true;
    }) => {
      this.tabs.created.push(url);
      return {};
    },
  };

  message<T = unknown>(
    message: unknown,
    sender: ChromeMessageSender = {
      id: this.runtime.id,
      url: this.runtime.getURL("community-review.html"),
    },
  ): Promise<CommunityPackResult<T>> {
    return new Promise((resolve) => {
      this.runtime.onMessage.emit(message, sender, (response) => {
        resolve(response as CommunityPackResult<T>);
      });
    });
  }
}

class FakeMessageRuntime implements ChromeRuntimeMessageApi {
  readonly id = "mcpatch-test";
  readonly onMessage = new FakeChromeEvent<
    [unknown, ChromeMessageSender, (response: unknown) => void]
  >();

  getURL(path: string): string {
    return `chrome-extension://${this.id}/${path}`;
  }
}

function stored(api: FakeEnablementApi) {
  return (
    parseCommunityPackState(api.storage.data[COMMUNITY_PACK_STORAGE_KEY]) ??
    EMPTY_COMMUNITY_PACK_STATE
  );
}

function reviewSender(url: string): ChromeMessageSender {
  return { id: "mcpatch-test", url };
}

function contentSender(): ChromeMessageSender {
  return {
    id: "mcpatch-test",
    documentId: "document-1",
    frameId: 0,
    tab: { id: 7 },
    url: LOCAL_URL,
  };
}

function pageIdentity() {
  return {
    tabId: 7,
    documentId: "document-1",
    origin: LOCAL_ORIGIN,
    url: LOCAL_URL,
  };
}

async function settle(controller: CommunityPackController): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await controller.idle();
  }
}
