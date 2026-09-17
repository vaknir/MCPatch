import { createHash } from "node:crypto";

import { PROTOCOL_VERSION } from "@mcpatch/protocol";
import {
  COMMUNITY_REGISTRY_INDEX_VERSION,
  MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
  MAX_COMMUNITY_REGISTRY_PACKS,
  MAX_DECLARATIVE_BUNDLE_BYTES,
  communityBundlePath,
  decodeDeclarativePackBundle,
  serializeDeclarativePackBundle,
  signCommunityRegistryIndex,
  signRegistryAttestation,
  verifyDeclarativePackBundle,
  type CommunityPackTrust,
  type CommunityRegistryIndexContent,
  type CommunityRegistryPackEntry,
  type CommunityRegistryRevocation,
  type CommunityRegistrySigningKeys,
  type CommunityRegistryVerificationEvidence,
} from "@mcpatch/sdk";

import { cliError } from "./errors.js";
import {
  loadPackSource,
  publishStaticTree,
  readBoundedRelativeFile,
  requireDirectory,
  resolveSafeRelativeDirectory,
} from "./files.js";
import { cleanRepositoryCommit, sourceCommit } from "./git-attribution.js";
import { preparePackSource } from "./source.js";
import { createSubmissionReview } from "./submission.js";

export const REGISTRY_SOURCE_FILE = "mcpatch.registry.json";
const REGISTRY_SOURCE_VERSION = 1;
const PUBLICATION_SOURCE_VERSION = 2;
const REGISTRY_OUTPUT_DIRECTORY = "registry-dist";
const CURRENT_RUNTIME_VERSION = "0.1.0";
const REGISTRY_PRIVATE_KEY_ENV = "MCPATCH_REGISTRY_PRIVATE_KEY";
const REGISTRY_PUBLIC_KEY_ENV = "MCPATCH_REGISTRY_PUBLIC_KEY";
const MAX_REGISTRY_VERSIONS_PER_PACK = 3;
const UTF8 = new TextEncoder();

type RegistryEnvironment = Readonly<Record<string, string | undefined>>;

type RegistryPackSource = Readonly<{
  readonly bundle: string;
  readonly source?: string;
  readonly reviewReport?: string;
  readonly publisherKey: string;
  readonly trust: CommunityPackTrust;
  readonly verification: CommunityRegistryVerificationEvidence;
  readonly revocation: CommunityRegistryRevocation;
}>;

type RegistrySource = Readonly<{
  readonly sourceVersion: number;
  readonly registryId: string;
  readonly publicationSequence: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly packs: readonly RegistryPackSource[];
}>;

export async function publishStaticRegistry(
  targetDirectory: string,
  environment: RegistryEnvironment,
): Promise<Readonly<Record<string, unknown>>> {
  await requireDirectory(targetDirectory, "registry.target");
  signingKeys(environment);
  const repositoryCommit = await cleanRepositoryCommit(targetDirectory);
  const sourceBytes = await readBoundedRelativeFile(
    targetDirectory,
    REGISTRY_SOURCE_FILE,
    MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
  );
  const source = readRegistrySource(sourceBytes);
  if (source.sourceVersion !== PUBLICATION_SOURCE_VERSION) {
    cliError("REGISTRY_SOURCE_INVALID", "$registry.registrySourceVersion");
  }

  for (const packSource of source.packs) {
    if (
      packSource.source === undefined ||
      packSource.reviewReport === undefined
    ) {
      cliError("REGISTRY_SOURCE_INVALID", "registry.packs.review");
    }
    const packDirectory = await resolveSafeRelativeDirectory(
      targetDirectory,
      packSource.source,
      "registry.packs.source",
    );
    const packRepositoryCommit = await cleanRepositoryCommit(packDirectory);
    const loaded = await loadPackSource(packDirectory);
    const commit = await sourceCommit(
      packDirectory,
      loaded.sourcePath,
      loaded.bytes,
    );
    if (
      commit !== packRepositoryCommit ||
      commit !== packSource.verification.sourceCommit
    ) {
      cliError(
        "PUBLICATION_REPRODUCTION_FAILED",
        "registry.packs.sourceCommit",
      );
    }
    const reproduced = await preparePackSource(loaded.bytes, {
      sourceCommit: commit,
    });
    const expectedReview = await createSubmissionReview(reproduced, commit);
    const reviewBytes = await readBoundedRelativeFile(
      targetDirectory,
      packSource.reviewReport,
      MAX_DECLARATIVE_BUNDLE_BYTES,
    );
    let submittedReview: unknown;
    try {
      submittedReview = decodeDeclarativePackBundle(reviewBytes);
    } catch {
      cliError("REVIEW_REPORT_INVALID", "registry.packs.reviewReport");
    }
    if (JSON.stringify(submittedReview) !== JSON.stringify(expectedReview)) {
      cliError("REVIEW_REPORT_INVALID", "registry.packs.reviewReport");
    }
    const bundleBytes = await readBoundedRelativeFile(
      targetDirectory,
      packSource.bundle,
      MAX_DECLARATIVE_BUNDLE_BYTES,
    );
    const verified = await verifyDeclarativePackBundle(bundleBytes, {
      trustedPublicKey: packSource.publisherKey,
      runtimeVersion: CURRENT_RUNTIME_VERSION,
      bridgeProtocolVersion: PROTOCOL_VERSION,
    });
    if (
      !verified.ok ||
      verified.bundle.registryAttestation !== undefined ||
      verified.bundle.manifest.digest !== reproduced.manifest.digest ||
      verified.bundle.metadata.sourceCommit !== commit
    ) {
      cliError("PUBLICATION_REPRODUCTION_FAILED", "registry.packs.bundle");
    }
  }

  const output = await buildStaticRegistry(targetDirectory, environment);
  return Object.freeze({
    ...output,
    status: "published",
    sourceCommit: repositoryCommit,
    reproducedPacks: source.packs.length,
  });
}

export async function buildStaticRegistry(
  targetDirectory: string,
  environment: RegistryEnvironment,
): Promise<Readonly<Record<string, unknown>>> {
  await requireDirectory(targetDirectory, "registry.target");
  const sourceBytes = await readBoundedRelativeFile(
    targetDirectory,
    REGISTRY_SOURCE_FILE,
    MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
  );
  const source = readRegistrySource(sourceBytes);
  for (const pack of source.packs) {
    if (
      pack.verification.verifiedAt > source.issuedAt ||
      (pack.revocation.status === "REVOKED" &&
        pack.revocation.revokedAt > source.issuedAt)
    ) {
      cliError("REGISTRY_SOURCE_INVALID", "registry.packs");
    }
  }
  const keys = signingKeys(environment);
  const files = new Map<string, Uint8Array>();
  const entries: CommunityRegistryPackEntry[] = [];

  for (const packSource of source.packs) {
    const input = await readBoundedRelativeFile(
      targetDirectory,
      packSource.bundle,
      MAX_DECLARATIVE_BUNDLE_BYTES,
    );
    const verified = await verifyDeclarativePackBundle(input, {
      trustedPublicKey: packSource.publisherKey,
      runtimeVersion: CURRENT_RUNTIME_VERSION,
      bridgeProtocolVersion: PROTOCOL_VERSION,
    });
    if (!verified.ok || verified.bundle.registryAttestation !== undefined) {
      cliError("REGISTRY_SOURCE_INVALID", "registry.packs.bundle");
    }
    const bundle = verified.bundle;
    if (
      bundle.publisherSignature.publicKey !== packSource.publisherKey ||
      bundle.metadata.sourceCommit !== packSource.verification.sourceCommit ||
      bundle.manifest.fixtures.length !==
        packSource.verification.fixtureTestsTotal ||
      packSource.verification.fixtureTestsPassed !==
        packSource.verification.fixtureTestsTotal
    ) {
      cliError("REGISTRY_SOURCE_INVALID", "registry.packs.verification");
    }
    const identity = {
      publisher: bundle.manifest.publisher,
      id: bundle.manifest.id,
      version: bundle.manifest.version,
      bundleDigest: bundle.manifest.digest,
    };
    const bundlePath = communityBundlePath(identity);
    let attestation;
    try {
      attestation = await signRegistryAttestation(
        {
          attestationVersion: 1,
          registryId: source.registryId,
          ...identity,
          publicationSequence: source.publicationSequence,
          reviewState: packSource.trust,
          issuedAt: source.issuedAt,
          expiresAt: source.expiresAt,
        },
        keys,
      );
    } catch {
      cliError("SIGNING_KEY_INVALID", "registry.signingKey");
    }
    entries.push({
      ...identity,
      name: bundle.manifest.name,
      description: bundle.manifest.description,
      bundlePath,
      publisherKey: packSource.publisherKey,
      trust: packSource.trust,
      origins: [
        ...new Set(bundle.manifest.matches.map((match) => match.origin)),
      ].sort(),
      tools: bundle.manifest.tools
        .map((tool) => ({
          name: tool.name,
          ...(tool.title === undefined ? {} : { title: tool.title }),
          description: tool.description,
          risk: tool.risk,
          permissions: tool.permissions,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      compatibility: {
        runtime: {
          minimum: bundle.manifest.compatibility.runtime.minimum,
          maximumExclusive:
            bundle.manifest.compatibility.runtime.maximumExclusive,
        },
        bridgeProtocol: {
          minimum: bundle.manifest.compatibility.bridgeProtocol.minimum,
          maximum: bundle.manifest.compatibility.bridgeProtocol.maximum,
        },
      },
      networkPolicy: { extensionRequests: "none" },
      verification: packSource.verification,
      revocation: packSource.revocation,
      attestation,
    });
    const relativeBundlePath = bundlePath.slice(1);
    if (files.has(relativeBundlePath)) {
      cliError("REGISTRY_SOURCE_INVALID", "registry.packs");
    }
    files.set(relativeBundlePath, serializeDeclarativePackBundle(bundle));
  }

  entries.sort((left, right) =>
    JSON.stringify([
      left.publisher,
      left.id,
      left.version,
      left.bundleDigest,
    ]).localeCompare(
      JSON.stringify([
        right.publisher,
        right.id,
        right.version,
        right.bundleDigest,
      ]),
    ),
  );
  const artifacts = new Set<string>();
  const versionCounts = new Map<string, number>();
  for (const entry of entries) {
    const identity = `${entry.publisher}/${entry.id}`;
    const artifact = `${identity}/${entry.version}`;
    const versionCount = (versionCounts.get(identity) ?? 0) + 1;
    if (
      artifacts.has(artifact) ||
      versionCount > MAX_REGISTRY_VERSIONS_PER_PACK
    ) {
      cliError("REGISTRY_SOURCE_INVALID", "registry.packs");
    }
    artifacts.add(artifact);
    versionCounts.set(identity, versionCount);
  }
  const content: CommunityRegistryIndexContent = {
    indexVersion: COMMUNITY_REGISTRY_INDEX_VERSION,
    registryId: source.registryId,
    publicationSequence: source.publicationSequence,
    issuedAt: source.issuedAt,
    expiresAt: source.expiresAt,
    packs: entries,
  };
  let index;
  try {
    index = await signCommunityRegistryIndex(content, keys);
  } catch {
    cliError("REGISTRY_SOURCE_INVALID", "registry.packs");
  }
  const indexBytes = UTF8.encode(`${JSON.stringify(index)}\n`);
  files.set("v1/index.json", indexBytes);
  files.set("_headers", UTF8.encode(staticHeaders()));
  const output = await publishStaticTree(
    targetDirectory,
    REGISTRY_OUTPUT_DIRECTORY,
    files,
  );
  return Object.freeze({
    status: "built",
    artifact: output.path,
    packs: entries.length,
    publicationSequence: source.publicationSequence,
    registryId: source.registryId,
    indexDigest: `sha256:${createHash("sha256").update(indexBytes).digest("hex")}`,
    bundleDigests: entries.map((entry) => entry.bundleDigest),
    reproducible: true,
    reused: output.reused,
  });
}

function readRegistrySource(input: Uint8Array): RegistrySource {
  let decoded: unknown;
  try {
    decoded = decodeDeclarativePackBundle(input);
  } catch {
    cliError("REGISTRY_SOURCE_INVALID", "$registry");
  }
  const source = exactObject(
    decoded,
    [
      "registrySourceVersion",
      "registryId",
      "publicationSequence",
      "issuedAt",
      "expiresAt",
      "packs",
    ],
    "$registry",
  );
  if (
    (source.registrySourceVersion !== REGISTRY_SOURCE_VERSION &&
      source.registrySourceVersion !== PUBLICATION_SOURCE_VERSION) ||
    typeof source.registryId !== "string" ||
    !/^[a-z][a-z0-9.-]{1,63}$/u.test(source.registryId) ||
    !positiveSafeInteger(source.publicationSequence) ||
    !canonicalTimestamp(source.issuedAt) ||
    !canonicalTimestamp(source.expiresAt) ||
    source.issuedAt >= source.expiresAt ||
    !Array.isArray(source.packs) ||
    source.packs.length === 0 ||
    source.packs.length > MAX_COMMUNITY_REGISTRY_PACKS
  ) {
    cliError("REGISTRY_SOURCE_INVALID", "$registry");
  }
  return Object.freeze({
    sourceVersion: source.registrySourceVersion,
    registryId: source.registryId,
    publicationSequence: source.publicationSequence,
    issuedAt: source.issuedAt,
    expiresAt: source.expiresAt,
    packs: Object.freeze(
      source.packs.map((pack, index) =>
        readPackSource(
          pack,
          `$registry.packs[${index}]`,
          source.registrySourceVersion as number,
        ),
      ),
    ),
  }) as RegistrySource;
}

function readPackSource(
  value: unknown,
  field: string,
  sourceVersion: number,
): RegistryPackSource {
  const fields =
    sourceVersion === PUBLICATION_SOURCE_VERSION
      ? [
          "bundle",
          "source",
          "reviewReport",
          "publisherKey",
          "trust",
          "verification",
          "revocation",
        ]
      : ["bundle", "publisherKey", "trust", "verification", "revocation"];
  const source = exactObject(value, fields, field);
  const verification = exactObject(
    source.verification,
    ["verifiedAt", "fixtureTestsPassed", "fixtureTestsTotal", "sourceCommit"],
    `${field}.verification`,
  );
  const revocation = readRevocation(source.revocation, `${field}.revocation`);
  if (
    typeof source.bundle !== "string" ||
    !source.bundle.endsWith(".mcpack") ||
    (sourceVersion === PUBLICATION_SOURCE_VERSION &&
      (typeof source.source !== "string" ||
        typeof source.reviewReport !== "string" ||
        !source.reviewReport.endsWith(".review.json"))) ||
    typeof source.publisherKey !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(source.publisherKey) ||
    (source.trust !== "OFFICIAL" && source.trust !== "REVIEWED_COMMUNITY") ||
    !canonicalTimestamp(verification.verifiedAt) ||
    !nonnegativeSafeInteger(verification.fixtureTestsPassed) ||
    !positiveSafeInteger(verification.fixtureTestsTotal) ||
    verification.fixtureTestsPassed !== verification.fixtureTestsTotal ||
    typeof verification.sourceCommit !== "string" ||
    !/^[a-f0-9]{40,64}$/u.test(verification.sourceCommit)
  ) {
    cliError("REGISTRY_SOURCE_INVALID", field);
  }
  return Object.freeze({
    bundle: source.bundle,
    ...(sourceVersion === PUBLICATION_SOURCE_VERSION
      ? {
          source: source.source as string,
          reviewReport: source.reviewReport as string,
        }
      : {}),
    publisherKey: source.publisherKey,
    trust: source.trust,
    verification: Object.freeze({
      verifiedAt: verification.verifiedAt,
      fixtureTestsPassed: verification.fixtureTestsPassed,
      fixtureTestsTotal: verification.fixtureTestsTotal,
      sourceCommit: verification.sourceCommit,
    }),
    revocation,
  }) as RegistryPackSource;
}

function readRevocation(
  value: unknown,
  field: string,
): CommunityRegistryRevocation {
  const record = dataObject(value, field);
  if (record.status === "ACTIVE") {
    exactObject(record, ["status"], field);
    return Object.freeze({ status: "ACTIVE" });
  }
  const revoked = exactObject(record, ["status", "revokedAt", "reason"], field);
  if (
    revoked.status !== "REVOKED" ||
    !canonicalTimestamp(revoked.revokedAt) ||
    (revoked.reason !== "SECURITY" &&
      revoked.reason !== "PUBLISHER" &&
      revoked.reason !== "SUPERSEDED")
  ) {
    cliError("REGISTRY_SOURCE_INVALID", field);
  }
  return Object.freeze({
    status: "REVOKED",
    revokedAt: revoked.revokedAt,
    reason: revoked.reason,
  });
}

function signingKeys(
  environment: RegistryEnvironment,
): CommunityRegistrySigningKeys {
  const privateKey = environment[REGISTRY_PRIVATE_KEY_ENV];
  const publicKey = environment[REGISTRY_PUBLIC_KEY_ENV];
  if (privateKey === undefined || publicKey === undefined) {
    cliError("SIGNING_KEY_MISSING", "registry.signingKey");
  }
  return Object.freeze({ privateKey, publicKey });
}

function exactObject(
  value: unknown,
  fields: readonly string[],
  field: string,
): Readonly<Record<string, unknown>> {
  const record = dataObject(value, field);
  const keys = Object.keys(record);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(record, key))
  ) {
    cliError("REGISTRY_SOURCE_INVALID", field);
  }
  return record;
}

function dataObject(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  const prototype =
    typeof value === "object" && value !== null
      ? (Object.getPrototypeOf(value) as unknown)
      : undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    cliError("REGISTRY_SOURCE_INVALID", field);
  }
  return value as Readonly<Record<string, unknown>>;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function staticHeaders(): string {
  return `/v1/index.json\n  Content-Type: application/vnd.mcpatch.registry-index+json\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n\n/v1/bundles/*\n  Content-Type: application/vnd.mcpatch.pack+json\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n`;
}
