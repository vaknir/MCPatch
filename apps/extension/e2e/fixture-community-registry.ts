import {
  communityBundlePath,
  computeDeclarativePackBundleDigest,
  parseDeclarativePackBundleContent,
  serializeDeclarativePackBundle,
  signCommunityRegistryIndex,
  signDeclarativePackBundle,
  signRegistryAttestation,
  type CommunityRegistryIndexContent,
  type CommunityRegistryPackEntry,
  type DeclarativePackBundle,
} from "@mcpatch/sdk";

import {
  COMMUNITY_ORIGIN,
  COMMUNITY_REGISTRY_PUBLIC_KEY,
  COMMUNITY_TOOL,
} from "./fixture-constants.js";
import { fixtureLocalBundle } from "./fixture-local-bundle.js";

export interface CommunityRegistryFixtureStage {
  readonly indexBytes: Uint8Array;
  readonly publicationSequence: number;
}

export interface CommunityRegistryFixture {
  readonly bundleBytes: Uint8Array;
  readonly bundlePath: string;
  readonly bundles: ReadonlyMap<string, Uint8Array>;
  readonly indexBytes: Uint8Array;
  readonly initial: CommunityRegistryFixtureStage;
  readonly update: CommunityRegistryFixtureStage;
  readonly revoked: CommunityRegistryFixtureStage;
  readonly initialBundlePath: string;
  readonly updateBundlePath: string;
}

export async function communityRegistryFixture(
  now = new Date(),
): Promise<CommunityRegistryFixture> {
  const initialBundle = await signedCommunityBundle("1.0.0", "b");
  const updateBundle = await signedCommunityBundle("1.1.0", "c");
  const issuedAt = canonicalTime(now.getTime() - 60 * 60 * 1_000);
  const expiresAt = canonicalTime(now.getTime() + 24 * 60 * 60 * 1_000);
  const initial = await stage(
    1,
    [artifact(initialBundle, { status: "ACTIVE" })],
    issuedAt,
    expiresAt,
    now,
  );
  const update = await stage(
    2,
    [
      artifact(initialBundle, { status: "ACTIVE" }),
      artifact(updateBundle, { status: "ACTIVE" }),
    ],
    issuedAt,
    expiresAt,
    now,
  );
  const revoked = await stage(
    3,
    [
      artifact(initialBundle, { status: "ACTIVE" }),
      artifact(updateBundle, {
        status: "REVOKED",
        revokedAt: canonicalTime(now.getTime() - 90 * 60 * 1_000),
        reason: "SECURITY",
      }),
    ],
    issuedAt,
    expiresAt,
    now,
  );
  if (encode(registryKeys().publicKey) !== COMMUNITY_REGISTRY_PUBLIC_KEY) {
    throw new Error("fixture registry key mismatch");
  }
  const initialIdentity = identity(initialBundle);
  const updateIdentity = identity(updateBundle);
  return Object.freeze({
    bundleBytes: serializeDeclarativePackBundle(initialBundle),
    bundlePath: communityBundlePath(initialIdentity),
    bundles: new Map([
      [
        communityBundlePath(initialIdentity),
        serializeDeclarativePackBundle(initialBundle),
      ],
      [
        communityBundlePath(updateIdentity),
        serializeDeclarativePackBundle(updateBundle),
      ],
    ]),
    initial,
    indexBytes: initial.indexBytes,
    update,
    revoked,
    initialBundlePath: communityBundlePath(initialIdentity),
    updateBundlePath: communityBundlePath(updateIdentity),
  });
}

async function stage(
  publicationSequence: number,
  artifacts: readonly Artifact[],
  issuedAt: string,
  expiresAt: string,
  now: Date,
): Promise<CommunityRegistryFixtureStage> {
  const packs = await Promise.all(
    artifacts.map(({ bundle, revocation }) =>
      entry(
        bundle,
        publicationSequence,
        issuedAt,
        expiresAt,
        canonicalTime(now.getTime() - 2 * 60 * 60 * 1_000),
        revocation,
      ),
    ),
  );
  const content: CommunityRegistryIndexContent = {
    indexVersion: 1,
    registryId: "mcpatch-registry",
    publicationSequence,
    issuedAt,
    expiresAt,
    packs: packs.sort((left, right) =>
      left.version.localeCompare(right.version),
    ),
  };
  const index = await signCommunityRegistryIndex(content, registryKeys());
  return Object.freeze({
    indexBytes: new TextEncoder().encode(JSON.stringify(index)),
    publicationSequence,
  });
}

type Revocation = CommunityRegistryPackEntry["revocation"];
type Artifact = Readonly<{
  readonly bundle: DeclarativePackBundle;
  readonly revocation: Revocation;
}>;

function artifact(
  bundle: DeclarativePackBundle,
  revocation: Revocation,
): Artifact {
  return Object.freeze({ bundle, revocation });
}

async function entry(
  bundle: DeclarativePackBundle,
  publicationSequence: number,
  issuedAt: string,
  expiresAt: string,
  verifiedAt: string,
  revocation: Revocation,
): Promise<CommunityRegistryPackEntry> {
  const bundleIdentity = identity(bundle);
  return {
    ...bundleIdentity,
    name: bundle.manifest.name,
    description: bundle.manifest.description,
    bundlePath: communityBundlePath(bundleIdentity),
    publisherKey: bundle.publisherSignature.publicKey,
    trust: "REVIEWED_COMMUNITY",
    origins: [COMMUNITY_ORIGIN],
    tools: bundle.manifest.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      permissions: tool.permissions,
    })),
    compatibility: bundle.manifest.compatibility,
    networkPolicy: bundle.manifest.networkPolicy,
    verification: {
      verifiedAt,
      fixtureTestsPassed: 1,
      fixtureTestsTotal: 1,
      sourceCommit: bundle.metadata.sourceCommit ?? "b".repeat(40),
    },
    revocation,
    attestation: await signRegistryAttestation(
      {
        attestationVersion: 1,
        registryId: "mcpatch-registry",
        ...bundleIdentity,
        publicationSequence,
        reviewState: "REVIEWED_COMMUNITY",
        issuedAt,
        expiresAt,
      },
      registryKeys(),
    ),
  };
}

function identity(bundle: DeclarativePackBundle) {
  return {
    publisher: bundle.manifest.publisher,
    id: bundle.manifest.id,
    version: bundle.manifest.version,
    bundleDigest: bundle.manifest.digest,
  };
}

async function signedCommunityBundle(version: string, commitByte: string) {
  const source = structuredClone(fixtureLocalBundle) as unknown as Record<
    string,
    unknown
  >;
  const manifest = source["manifest"] as Record<string, unknown>;
  manifest["publisher"] = "community";
  manifest["id"] = "visible-page";
  manifest["name"] = "Chromium signed community fixture";
  manifest["description"] =
    `Read visible text through signed registry pack version ${version}.`;
  manifest["version"] = version;
  manifest["digest"] = `sha256:${"0".repeat(64)}`;
  manifest["matches"] = [
    {
      origin: COMMUNITY_ORIGIN,
      paths: [{ kind: "prefix", path: "/" }],
      wholeOrigin: true,
    },
  ];
  const tools = manifest["tools"] as Array<Record<string, unknown>>;
  const tool = tools[0];
  if (tool === undefined) throw new Error("fixture tool missing");
  tool["name"] = COMMUNITY_TOOL;
  tool["description"] = "Read visible text from the selected community page.";
  const fixtures = manifest["fixtures"] as Array<Record<string, unknown>>;
  const fixture = fixtures[0];
  if (fixture === undefined) throw new Error("fixture evidence missing");
  fixture["tool"] = COMMUNITY_TOOL;
  const operations = source["operations"] as {
    program: { operations: Array<Record<string, unknown>> };
  };
  const operation = operations.program.operations[0];
  if (operation === undefined) throw new Error("fixture operation missing");
  operation["tool"] = COMMUNITY_TOOL;
  source["metadata"] = {
    license: "MIT",
    sourceCommit: commitByte.repeat(40),
  };
  const provisional = parseDeclarativePackBundleContent(source);
  manifest["digest"] = await computeDeclarativePackBundleDigest(provisional);
  const content = parseDeclarativePackBundleContent(source);
  return signDeclarativePackBundle(content, publisherKeys());
}

function canonicalTime(value: number): string {
  return new Date(value).toISOString();
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
