import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  communityBundlePath,
  parseCommunityRegistryIndex,
  signCommunityRegistryIndex,
  signRegistryAttestation,
  validateCommunityRegistryIndex,
  verifyCommunityRegistryIndex,
  verifyRegistryAttestation,
  type CommunityRegistryIndexContent,
  type CommunityRegistryPackEntry,
} from "../src/index.js";

const REGISTRY_ID = "mcpatch-registry";
const NOW = new Date("2026-09-17T00:00:00.000Z");
const ISSUED_AT = "2026-09-16T23:00:00.000Z";
const EXPIRES_AT = "2026-09-24T23:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}`;

describe("community registry index v1", () => {
  it("signs, strictly parses, and verifies one immutable pack entry", async () => {
    const index = await signedIndex();
    const bytes = JSON.stringify(index);
    const schema = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../schema/v1/community-registry-index.schema.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as AnySchema;
    const validateSchema = new Ajv2020({
      strict: true,
      validateFormats: false,
    }).compile(schema);

    const parsed = parseCommunityRegistryIndex(bytes);
    expect(validateSchema(parsed), JSON.stringify(validateSchema.errors)).toBe(
      true,
    );
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed.packs[0]?.bundlePath).toBe(
      `/v1/bundles/example/weather/0.1.0/${"a".repeat(64)}.mcpack`,
    );
    await expect(
      verifyCommunityRegistryIndex(bytes, {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(registryKeys().publicKey),
        now: NOW,
      }),
    ).resolves.toMatchObject({
      ok: true,
      index: { publicationSequence: 7 },
    });
    await expect(
      verifyRegistryAttestation(JSON.stringify(parsed.packs[0]?.attestation), {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(registryKeys().publicKey),
        now: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("rejects substitution, another trust root, and another registry identity", async () => {
    const index = await signedIndex();
    const substituted = structuredClone(index) as unknown as {
      packs: Array<{ name: string }>;
    };
    const first = substituted.packs[0];
    if (first === undefined) throw new Error("missing registry fixture");
    first.name = "Substituted";

    await expect(verify(substituted)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_SIGNATURE",
    });
    await expect(
      verifyCommunityRegistryIndex(JSON.stringify(index), {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(publisherKeys().publicKey),
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_SIGNATURE" });
    await expect(
      verifyCommunityRegistryIndex(JSON.stringify(index), {
        expectedRegistryId: "other-registry",
        publicKey: encode(registryKeys().publicKey),
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_SIGNATURE" });
  });

  it("enforces publication high-water and signed freshness", async () => {
    const index = await signedIndex();

    await expect(
      verifyCommunityRegistryIndex(JSON.stringify(index), {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(registryKeys().publicKey),
        minimumPublicationSequence: 8,
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: false, code: "ROLLBACK" });
    await expect(
      verifyCommunityRegistryIndex(JSON.stringify(index), {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(registryKeys().publicKey),
        now: new Date("2026-09-25T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: false, code: "EXPIRED" });
    await expect(
      verifyCommunityRegistryIndex(JSON.stringify(index), {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(registryKeys().publicKey),
        now: new Date("2026-09-16T22:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_YET_VALID" });
    await expect(
      verifyCommunityRegistryIndex(JSON.stringify(index), {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(registryKeys().publicKey),
        minimumPublicationSequence: Number.NaN,
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INDEX" });
  });

  it("rejects duplicate keys, truncation, duplicate identities, unsafe origins, and mutable paths", async () => {
    const index = await signedIndex();
    expect(
      validateCommunityRegistryIndex({
        ...index,
        packs: [index.packs[0], index.packs[0]],
      }),
    ).toBe(false);
    expect(
      validateCommunityRegistryIndex({
        ...index,
        packs: [{ ...index.packs[0], origins: ["https://*.example.com"] }],
      }),
    ).toBe(false);
    expect(
      validateCommunityRegistryIndex({
        ...index,
        packs: [{ ...index.packs[0], bundlePath: "/latest.mcpack" }],
      }),
    ).toBe(false);
    await expect(
      verifyCommunityRegistryIndex('{"indexVersion":1,"indexVersion":1}', {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(registryKeys().publicKey),
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INDEX" });
    await expect(
      verifyCommunityRegistryIndex(JSON.stringify(index).slice(0, -5), {
        expectedRegistryId: REGISTRY_ID,
        publicKey: encode(registryKeys().publicKey),
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INDEX" });
  });

  it("derives only canonical digest-addressed bundle paths", () => {
    expect(
      communityBundlePath({
        publisher: "example",
        id: "weather",
        version: "0.1.0",
        bundleDigest: DIGEST,
      }),
    ).toBe(`/v1/bundles/example/weather/0.1.0/${"a".repeat(64)}.mcpack`);
    expect(() =>
      communityBundlePath({
        publisher: "example",
        id: "weather",
        version: "../../latest",
        bundleDigest: DIGEST,
      }),
    ).toThrow(TypeError);
  });
});

async function signedIndex() {
  const entry = await registryEntry();
  const content: CommunityRegistryIndexContent = {
    indexVersion: 1,
    registryId: REGISTRY_ID,
    publicationSequence: 7,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    packs: [entry],
  };
  return signCommunityRegistryIndex(content, registryKeys());
}

async function registryEntry(): Promise<CommunityRegistryPackEntry> {
  const identity = {
    publisher: "example",
    id: "weather",
    version: "0.1.0",
    bundleDigest: DIGEST,
  };
  return {
    ...identity,
    name: "Weather reader",
    description: "Reads weather already rendered in the current document.",
    bundlePath: communityBundlePath(identity),
    publisherKey: encode(publisherKeys().publicKey),
    trust: "REVIEWED_COMMUNITY",
    origins: ["https://weather.example.com"],
    tools: [
      {
        name: "weather.current",
        description: "Read current weather.",
        risk: "read",
        permissions: ["READ"],
      },
    ],
    compatibility: {
      runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
      bridgeProtocol: { minimum: 2, maximum: 2 },
    },
    networkPolicy: { extensionRequests: "none" },
    verification: {
      verifiedAt: "2026-09-16T22:00:00.000Z",
      fixtureTestsPassed: 4,
      fixtureTestsTotal: 4,
      sourceCommit: "1".repeat(40),
    },
    revocation: { status: "ACTIVE" },
    attestation: await signRegistryAttestation(
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
    ),
  };
}

function verify(value: unknown) {
  return verifyCommunityRegistryIndex(JSON.stringify(value), {
    expectedRegistryId: REGISTRY_ID,
    publicKey: encode(registryKeys().publicKey),
    now: NOW,
  });
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
