import { describe, expect, it, vi } from "vitest";

import {
  communityBundlePath,
  signCommunityRegistryIndex,
  signDeclarativePackBundle,
  signRegistryAttestation,
  verifyDeclarativePackBundle,
  verifyRegistryAttestation,
  type CommunityRegistryIndex,
  type CommunityRegistryIndexContent,
  type CommunityRegistryPackEntry,
  type DeclarativePackBundle,
} from "@mcpatch/sdk";

import {
  CommunityRegistryClient,
  RegistryClientError,
  type RegistryFetch,
  type RegistryFetchResponse,
} from "../src/community-registry-client.js";
import { localBundle } from "./support/local-pack.js";
import { communityRegistryFixture } from "../e2e/fixture-community-registry.js";
import {
  COMMUNITY_REGISTRY_PUBLIC_KEY,
  COMMUNITY_REGISTRY_ORIGIN,
} from "../e2e/fixture-constants.js";

const ORIGIN = "https://registry.fixture.test";
const INDEX_URL = `${ORIGIN}/v1/index.json`;
const REGISTRY_ID = "mcpatch-registry";
const NOW = new Date("2026-09-17T00:00:00.000Z");
const ISSUED_AT = "2026-09-16T23:00:00.000Z";
const EXPIRES_AT = "2026-09-24T23:00:00.000Z";

describe("fixed-origin community registry client", () => {
  it("verifies the disposable fixed-origin browser fixture", async () => {
    const fixture = await communityRegistryFixture(NOW);
    const client = new CommunityRegistryClient(
      {
        origin: COMMUNITY_REGISTRY_ORIGIN,
        indexPath: "/v1/index.json",
        registryId: REGISTRY_ID,
        publicKey: COMMUNITY_REGISTRY_PUBLIC_KEY,
      },
      runtimeOptions(),
      vi.fn<RegistryFetch>(),
    );
    const index = await client.indexFromCache(fixture.indexBytes, 0, NOW);
    const entry = index.packs[0];
    if (entry === undefined)
      throw new Error("browser registry fixture missing");
    const fixtureBundle = JSON.parse(
      new TextDecoder().decode(fixture.bundleBytes),
    ) as DeclarativePackBundle;
    expect({
      publisher: fixtureBundle.manifest.publisher,
      id: fixtureBundle.manifest.id,
      name: fixtureBundle.manifest.name,
      description: fixtureBundle.manifest.description,
      version: fixtureBundle.manifest.version,
      bundleDigest: fixtureBundle.manifest.digest,
      publisherKey: fixtureBundle.publisherSignature.publicKey,
      origins: [
        ...new Set(fixtureBundle.manifest.matches.map((match) => match.origin)),
      ].sort(),
      tools: fixtureBundle.manifest.tools.map((tool) => ({
        name: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        description: tool.description,
        risk: tool.risk,
        permissions: tool.permissions,
      })),
      compatibility: fixtureBundle.manifest.compatibility,
      networkPolicy: fixtureBundle.manifest.networkPolicy,
      sourceCommit: fixtureBundle.metadata.sourceCommit,
    }).toEqual({
      publisher: entry.publisher,
      id: entry.id,
      name: entry.name,
      description: entry.description,
      version: entry.version,
      bundleDigest: entry.bundleDigest,
      publisherKey: entry.publisherKey,
      origins: entry.origins,
      tools: entry.tools,
      compatibility: entry.compatibility,
      networkPolicy: entry.networkPolicy,
      sourceCommit: entry.verification.sourceCommit,
    });
    await expect(
      verifyRegistryAttestation(JSON.stringify(entry.attestation), {
        expectedRegistryId: REGISTRY_ID,
        publicKey: COMMUNITY_REGISTRY_PUBLIC_KEY,
        now: NOW,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyDeclarativePackBundle(fixture.bundleBytes, {
        trustedPublicKey: entry.publisherKey,
        runtimeVersion: "0.1.0",
        bridgeProtocolVersion: 2,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.verifyPackBytes(index, entry, fixture.bundleBytes, NOW),
    ).resolves.toMatchObject({
      content: { manifest: { publisher: "community", id: "visible-page" } },
    });
  });

  it("fetches and verifies an index and exact immutable publisher-signed bundle", async () => {
    const fixture = await registryFixture();
    const fetch = fixtureFetch(fixture);
    const client = registryClient(fetch);

    const index = await client.index(0, NOW);
    const entry = index.packs[0];
    if (entry === undefined) throw new Error("missing registry fixture");
    const pack = await client.pack(index, entry, NOW);

    expect(pack.content.manifest.digest).toBe(entry.bundleDigest);
    expect(pack.entry.trust).toBe("REVIEWED_COMMUNITY");
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      INDEX_URL,
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `${ORIGIN}${entry.bundlePath}`,
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  });

  it.each([
    { contentType: "application/json", redirected: false, status: 200 },
    {
      contentType: "application/vnd.mcpatch.registry-index+json",
      redirected: true,
      status: 200,
    },
    {
      contentType: "application/vnd.mcpatch.registry-index+json",
      redirected: false,
      status: 206,
    },
  ])("rejects unsafe index response metadata %#", async (override) => {
    const fixture = await registryFixture();
    const fetch = vi.fn<RegistryFetch>(async (url) =>
      response(
        fixture.indexBytes,
        override.contentType,
        url,
        override.status,
        override.redirected,
      ),
    );
    await expect(registryClient(fetch).index(0, NOW)).rejects.toMatchObject({
      code: "NETWORK_REJECTED",
    });
  });

  it("rejects redirects, truncation, substitution, and response overflow", async () => {
    const fixture = await registryFixture();
    const redirected = vi.fn<RegistryFetch>(async () =>
      response(
        fixture.indexBytes,
        "application/vnd.mcpatch.registry-index+json",
        `${ORIGIN}/redirected.json`,
      ),
    );
    await expect(
      registryClient(redirected).index(0, NOW),
    ).rejects.toMatchObject({ code: "NETWORK_REJECTED" });

    for (const bytes of [
      fixture.indexBytes.slice(0, -7),
      replaceBytes(
        fixture.indexBytes,
        "Declarative read example",
        "Injected name",
      ),
    ]) {
      const fetch = vi.fn<RegistryFetch>(async (url) =>
        response(bytes, "application/vnd.mcpatch.registry-index+json", url),
      );
      await expect(registryClient(fetch).index(0, NOW)).rejects.toMatchObject({
        code: "INDEX_REJECTED",
      });
    }

    const overflow = vi.fn<RegistryFetch>(async (url) => ({
      ...response(
        fixture.indexBytes,
        "application/vnd.mcpatch.registry-index+json",
        url,
      ),
      body: stream([new Uint8Array(700_000), new Uint8Array(700_000)]),
      headers: headers({
        "content-type": "application/vnd.mcpatch.registry-index+json",
      }),
    }));
    await expect(registryClient(overflow).index(0, NOW)).rejects.toMatchObject({
      code: "NETWORK_REJECTED",
    });

    const truncatedTransport = vi.fn<RegistryFetch>(async (url) => ({
      ...response(
        fixture.indexBytes.slice(0, -1),
        "application/vnd.mcpatch.registry-index+json",
        url,
      ),
      headers: headers({
        "content-length": String(fixture.indexBytes.byteLength),
        "content-type": "application/vnd.mcpatch.registry-index+json",
      }),
    }));
    await expect(
      registryClient(truncatedTransport).index(0, NOW),
    ).rejects.toMatchObject({ code: "NETWORK_REJECTED" });
  });

  it("rejects substituted bundles, wrong MIME, and revoked entries", async () => {
    const fixture = await registryFixture();
    const index = await registryClient(fixtureFetch(fixture)).index(0, NOW);
    const entry = index.packs[0];
    if (entry === undefined) throw new Error("missing registry fixture");

    const substituted = vi.fn<RegistryFetch>(async (url) =>
      url === INDEX_URL
        ? response(
            fixture.indexBytes,
            "application/vnd.mcpatch.registry-index+json",
            url,
          )
        : response(
            replaceBytes(fixture.bundleBytes, "fixture-item", "attacker-item"),
            "application/vnd.mcpatch.pack+json",
            url,
          ),
    );
    await expect(
      registryClient(substituted).pack(index, entry, NOW),
    ).rejects.toMatchObject({ code: "BUNDLE_REJECTED" });

    const wrongMime = vi.fn<RegistryFetch>(async (url) =>
      response(fixture.bundleBytes, "application/json", url),
    );
    await expect(
      registryClient(wrongMime).pack(index, entry, NOW),
    ).rejects.toMatchObject({ code: "NETWORK_REJECTED" });

    const revoked = await registryFixture({ revoked: true });
    const revokedIndex = await registryClient(fixtureFetch(revoked)).index(
      0,
      NOW,
    );
    const revokedEntry = revokedIndex.packs[0];
    if (revokedEntry === undefined) throw new Error("missing registry fixture");
    const noFetch = vi.fn<RegistryFetch>();
    await expect(
      registryClient(noFetch).pack(revokedIndex, revokedEntry, NOW),
    ).rejects.toMatchObject({ code: "PACK_REVOKED" });
    expect(noFetch).not.toHaveBeenCalled();
  });

  it("rejects local, IP, non-HTTPS, and caller-selected registry configurations", () => {
    const fetch = vi.fn<RegistryFetch>();
    for (const origin of [
      "http://registry.example.com",
      "https://localhost",
      "https://127.0.0.1",
      "https://[::1]",
      "chrome-extension://example",
    ]) {
      expect(
        () =>
          new CommunityRegistryClient(
            {
              origin,
              indexPath: "/v1/index.json",
              registryId: REGISTRY_ID,
              publicKey: encode(registryKeys().publicKey),
            },
            runtimeOptions(),
            fetch,
          ),
      ).toThrow(TypeError);
    }
    expect(
      () =>
        new CommunityRegistryClient(
          {
            origin: ORIGIN,
            indexPath: "/caller-selected.json",
            registryId: REGISTRY_ID,
            publicKey: encode(registryKeys().publicKey),
          },
          runtimeOptions(),
          fetch,
        ),
    ).toThrow(TypeError);
  });

  it("normalizes network failures to a payload-free code", async () => {
    const marker = "private-network-error";
    const fetch = vi.fn<RegistryFetch>(async () => {
      throw new Error(marker);
    });
    const failure = registryClient(fetch).index(0, NOW);
    await expect(failure).rejects.toEqual(
      new RegistryClientError("NETWORK_REJECTED"),
    );
    await expect(failure).rejects.not.toHaveProperty("message", marker);
  });
});

async function registryFixture(options: { readonly revoked?: boolean } = {}) {
  const content = await localBundle();
  const bundle = await signDeclarativePackBundle(content, publisherKeys());
  const identity = {
    publisher: bundle.manifest.publisher,
    id: bundle.manifest.id,
    version: bundle.manifest.version,
    bundleDigest: bundle.manifest.digest,
  };
  const attestation = await signRegistryAttestation(
    {
      attestationVersion: 1,
      registryId: REGISTRY_ID,
      ...identity,
      publicationSequence: 7,
      reviewState: "REVIEWED_COMMUNITY",
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    },
    registryKeys(),
  );
  const entry: CommunityRegistryPackEntry = {
    ...identity,
    name: bundle.manifest.name,
    description: bundle.manifest.description,
    bundlePath: communityBundlePath(identity),
    publisherKey: bundle.publisherSignature.publicKey,
    trust: "REVIEWED_COMMUNITY",
    origins: ["https://example.com"],
    tools: bundle.manifest.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      permissions: tool.permissions,
    })),
    compatibility: bundle.manifest.compatibility,
    networkPolicy: bundle.manifest.networkPolicy,
    verification: {
      verifiedAt: "2026-09-16T22:00:00.000Z",
      fixtureTestsPassed: 1,
      fixtureTestsTotal: 1,
      sourceCommit: bundle.metadata.sourceCommit ?? "a".repeat(40),
    },
    revocation: options.revoked
      ? {
          status: "REVOKED",
          revokedAt: "2026-09-16T22:30:00.000Z",
          reason: "SECURITY",
        }
      : { status: "ACTIVE" },
    attestation,
  };
  const indexContent: CommunityRegistryIndexContent = {
    indexVersion: 1,
    registryId: REGISTRY_ID,
    publicationSequence: 7,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    packs: [entry],
  };
  const index = await signCommunityRegistryIndex(indexContent, registryKeys());
  return {
    bundle,
    bundleBytes: bytes(bundle),
    index,
    indexBytes: bytes(index),
  };
}

function fixtureFetch(fixture: {
  readonly bundleBytes: Uint8Array;
  readonly indexBytes: Uint8Array;
}) {
  return vi.fn<RegistryFetch>(async (url) => {
    if (url === INDEX_URL) {
      return response(
        fixture.indexBytes,
        "application/vnd.mcpatch.registry-index+json",
        url,
      );
    }
    return response(
      fixture.bundleBytes,
      "application/vnd.mcpatch.pack+json",
      url,
    );
  });
}

function registryClient(fetch: RegistryFetch) {
  return new CommunityRegistryClient(
    {
      origin: ORIGIN,
      indexPath: "/v1/index.json",
      registryId: REGISTRY_ID,
      publicKey: encode(registryKeys().publicKey),
    },
    runtimeOptions(),
    fetch,
  );
}

function runtimeOptions() {
  return {
    runtimeVersion: "0.1.0",
    bridgeProtocolVersion: 2,
    allowedPermissions: ["READ"] as const,
  };
}

function response(
  body: Uint8Array,
  contentType: string,
  url: string,
  status = 200,
  redirected = false,
): RegistryFetchResponse {
  return {
    body: stream([body]),
    headers: headers({
      "content-length": String(body.byteLength),
      "content-type": contentType,
    }),
    ok: status >= 200 && status < 300,
    redirected,
    status,
    url,
  };
}

function stream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function headers(values: Readonly<Record<string, string>>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function replaceBytes(
  source: Uint8Array,
  expected: string,
  replacement: string,
): Uint8Array {
  return new TextEncoder().encode(
    new TextDecoder().decode(source).replace(expected, replacement),
  );
}

function bytes(value: CommunityRegistryIndex | DeclarativePackBundle) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function registryKeys() {
  return {
    privateKey: hex(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    ),
    publicKey: hex(
      "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
    ),
  };
}

function publisherKeys() {
  return {
    privateKey: hex(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    ),
    publicKey: hex(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    ),
  };
}

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}
