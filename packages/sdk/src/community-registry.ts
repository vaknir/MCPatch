import * as ed25519 from "@noble/ed25519";

import {
  canonicalizeOrThrow,
  concat,
  encodeUtf8,
} from "./declarative-bundle-canonical.js";
import {
  decodeDeclarativePackBundle,
  decodeBase64Url,
  encodeBase64Url,
} from "./declarative-bundle-encoding.js";
import {
  bytesEqual,
  validateBundleBounds,
} from "./declarative-bundle-limits.js";
import {
  publisherKeyId,
  registryAttestationSigningBytes,
} from "./declarative-bundle-crypto.js";
import {
  isCanonicalTimestamp,
  validateRegistryAttestationShape,
} from "./declarative-bundle-validation.js";
import type { RegistryAttestation } from "./declarative-bundle-types.js";
import type {
  CommunityRegistryIndex,
  CommunityRegistryIndexContent,
  CommunityRegistryPackEntry,
  CommunityRegistrySigningKeys,
  CommunityRegistryVerificationOptions,
  CommunityRegistryVerificationResult,
  RegistryAttestationContent,
} from "./community-registry-types.js";
import {
  COMMUNITY_REGISTRY_INDEX_VERSION,
  COMMUNITY_REGISTRY_SIGNATURE_VERSION,
  MAX_COMMUNITY_REGISTRY_VERSIONS_PER_PACK,
} from "./community-registry-types.js";
import { cloneAndFreeze, isRecord } from "./validation/primitives.js";

export const MAX_COMMUNITY_REGISTRY_PACKS = 256;
export const MAX_COMMUNITY_REGISTRY_INDEX_BYTES = 1024 * 1024;
const DOMAIN_INDEX = "MCPatch community registry index signature\0index=1\0";
const REGISTRY_ID = /^[a-z][a-z0-9.-]{1,63}$/u;
const PUBLISHER = /^[a-z][a-z0-9]{0,63}$/u;
const PACK_ID = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/u;
const TOOL_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40,64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const KEY_ID = /^ed25519:[a-z][a-z0-9.-]{1,63}:sha256:[a-f0-9]{64}$/u;
const RISKS = new Set(["read", "action", "sensitive"]);
const PERMISSIONS = new Set([
  "READ",
  "ACTION",
  "SENSITIVE",
  "CREDENTIAL",
  "EXTERNAL_NETWORK",
  "ARBITRARY_EXECUTION",
]);

export function parseCommunityRegistryIndex(
  input: string | Uint8Array,
): CommunityRegistryIndex {
  if (utf8Bytes(input) > MAX_COMMUNITY_REGISTRY_INDEX_BYTES) {
    throw new TypeError("community registry index was rejected");
  }
  const value = decodeDeclarativePackBundle(input);
  if (!validateCommunityRegistryIndex(value)) {
    throw new TypeError("community registry index was rejected");
  }
  return cloneAndFreeze(value) as CommunityRegistryIndex;
}

export function validateCommunityRegistryIndex(value: unknown): boolean {
  if (!isRecord(value) || !exactFields(value, [...CONTENT_FIELDS, "signature"]))
    return false;
  const signature = value.signature;
  const content = contentFromRecord(value);
  if (!validateContent(content)) return false;
  return validateIndexSignature(signature, content.registryId);
}

export async function verifyCommunityRegistryIndex(
  input: string | Uint8Array,
  options: CommunityRegistryVerificationOptions,
): Promise<CommunityRegistryVerificationResult> {
  let index: CommunityRegistryIndex;
  try {
    index = parseCommunityRegistryIndex(input);
  } catch {
    return { ok: false, code: "INVALID_INDEX" };
  }
  if (index.registryId !== options.expectedRegistryId) {
    return { ok: false, code: "INVALID_SIGNATURE" };
  }
  const now = options.now?.getTime() ?? Date.now();
  if (
    !Number.isFinite(now) ||
    (options.minimumPublicationSequence !== undefined &&
      !nonnegativeSafeInteger(options.minimumPublicationSequence))
  ) {
    return { ok: false, code: "INVALID_INDEX" };
  }
  if (Date.parse(index.issuedAt) > now) {
    return { ok: false, code: "NOT_YET_VALID" };
  }
  if (now >= Date.parse(index.expiresAt)) {
    return { ok: false, code: "EXPIRED" };
  }
  if (
    options.minimumPublicationSequence !== undefined &&
    index.publicationSequence < options.minimumPublicationSequence
  ) {
    return { ok: false, code: "ROLLBACK" };
  }
  try {
    if (
      index.signature.keyId !==
      (await publisherKeyId(index.registryId, options.publicKey))
    ) {
      return { ok: false, code: "INVALID_SIGNATURE" };
    }
    const valid = await ed25519.verifyAsync(
      decodeBase64Url(index.signature.signature, "registryIndex"),
      indexSigningBytes(index),
      decodeBase64Url(options.publicKey, "registryIndex"),
      { zip215: false },
    );
    return valid
      ? { ok: true, index }
      : { ok: false, code: "INVALID_SIGNATURE" };
  } catch {
    return { ok: false, code: "INVALID_SIGNATURE" };
  }
}

export async function signCommunityRegistryIndex(
  content: CommunityRegistryIndexContent,
  keys: CommunityRegistrySigningKeys,
): Promise<CommunityRegistryIndex> {
  if (!validateContent(content)) {
    throw new TypeError("community registry content was rejected");
  }
  const keyPair = await checkedKeys(keys);
  const unsigned = cloneAndFreeze(content) as CommunityRegistryIndexContent;
  const signature = Object.freeze({
    signatureVersion: COMMUNITY_REGISTRY_SIGNATURE_VERSION,
    algorithm: "Ed25519" as const,
    keyId: await publisherKeyId(unsigned.registryId, keyPair.publicKey),
    signature: encodeBase64Url(
      await ed25519.signAsync(indexSigningBytes(unsigned), keyPair.privateKey),
    ),
  });
  const index = { ...unsigned, signature };
  if (!validateCommunityRegistryIndex(index)) {
    throw new TypeError("signed community registry index was rejected");
  }
  return cloneAndFreeze(index) as CommunityRegistryIndex;
}

export async function signRegistryAttestation(
  content: RegistryAttestationContent,
  keys: CommunityRegistrySigningKeys,
): Promise<RegistryAttestation> {
  const keyPair = await checkedKeys(keys);
  const keyId = await publisherKeyId(content.registryId, keyPair.publicKey);
  const placeholder: RegistryAttestation = {
    ...content,
    keyId,
    signature: encodeBase64Url(new Uint8Array(64)),
  };
  if (validateRegistryAttestationShape(placeholder) !== undefined) {
    throw new TypeError("registry attestation content was rejected");
  }
  const attestation: RegistryAttestation = {
    ...content,
    keyId,
    signature: encodeBase64Url(
      await ed25519.signAsync(
        registryAttestationSigningBytes(placeholder),
        keyPair.privateKey,
      ),
    ),
  };
  if (validateRegistryAttestationShape(attestation) !== undefined) {
    throw new TypeError("signed registry attestation was rejected");
  }
  return cloneAndFreeze(attestation) as RegistryAttestation;
}

export function communityBundlePath(entry: {
  readonly publisher: string;
  readonly id: string;
  readonly version: string;
  readonly bundleDigest: string;
}): string {
  if (
    !PUBLISHER.test(entry.publisher) ||
    !PACK_ID.test(entry.id) ||
    !SEMVER.test(entry.version) ||
    !DIGEST.test(entry.bundleDigest)
  ) {
    throw new TypeError("community bundle identity was rejected");
  }
  return `/v1/bundles/${entry.publisher}/${entry.id}/${entry.version}/${entry.bundleDigest.slice("sha256:".length)}.mcpack`;
}

export function indexSigningBytes(
  index: CommunityRegistryIndexContent | CommunityRegistryIndex,
): Uint8Array {
  const content = contentOf(index);
  if (!validateContent(content)) {
    throw new TypeError("community registry content was rejected");
  }
  return concat(
    encodeUtf8(DOMAIN_INDEX),
    encodeUtf8(canonicalizeOrThrow(content)),
  );
}

function validateContent(
  value: unknown,
): value is CommunityRegistryIndexContent {
  if (!isRecord(value) || !exactFields(value, CONTENT_FIELDS)) return false;
  if (
    value.indexVersion !== COMMUNITY_REGISTRY_INDEX_VERSION ||
    typeof value.registryId !== "string" ||
    !REGISTRY_ID.test(value.registryId) ||
    !positiveSafeInteger(value.publicationSequence) ||
    !isCanonicalTimestamp(value.issuedAt) ||
    !isCanonicalTimestamp(value.expiresAt) ||
    value.issuedAt >= value.expiresAt ||
    !Array.isArray(value.packs) ||
    value.packs.length > MAX_COMMUNITY_REGISTRY_PACKS
  ) {
    return false;
  }
  if (validateBundleBounds(value) !== undefined) return false;
  const artifacts = new Set<string>();
  const versionCounts = new Map<string, number>();
  let previous = "";
  for (const candidate of value.packs) {
    if (!validatePackEntry(candidate, value)) return false;
    const entry = candidate as CommunityRegistryPackEntry;
    const identity = `${entry.publisher}/${entry.id}`;
    const artifact = `${identity}/${entry.version}`;
    const sortKey = JSON.stringify([
      entry.publisher,
      entry.id,
      entry.version,
      entry.bundleDigest,
    ]);
    const versionCount = (versionCounts.get(identity) ?? 0) + 1;
    if (
      artifacts.has(artifact) ||
      versionCount > MAX_COMMUNITY_REGISTRY_VERSIONS_PER_PACK ||
      (previous !== "" && previous >= sortKey)
    ) {
      return false;
    }
    artifacts.add(artifact);
    versionCounts.set(identity, versionCount);
    previous = sortKey;
  }
  return true;
}

function validatePackEntry(
  value: unknown,
  index: Readonly<Record<string, unknown>>,
): boolean {
  if (!isRecord(value) || !exactFields(value, ENTRY_FIELDS)) return false;
  if (
    typeof value.publisher !== "string" ||
    !PUBLISHER.test(value.publisher) ||
    typeof value.id !== "string" ||
    !PACK_ID.test(value.id) ||
    !boundedText(value.name, 128) ||
    !boundedText(value.description, 512) ||
    typeof value.version !== "string" ||
    !SEMVER.test(value.version) ||
    typeof value.bundleDigest !== "string" ||
    !DIGEST.test(value.bundleDigest) ||
    typeof value.bundlePath !== "string" ||
    value.bundlePath !==
      communityBundlePath(value as CommunityRegistryPackEntry) ||
    !validPublicKey(value.publisherKey) ||
    (value.trust !== "OFFICIAL" && value.trust !== "REVIEWED_COMMUNITY") ||
    !validateOrigins(value.origins) ||
    !validateTools(value.tools) ||
    !validateCompatibility(value.compatibility) ||
    !validateNetworkPolicy(value.networkPolicy) ||
    !validateEvidence(value.verification, index.issuedAt) ||
    !validateRevocation(value.revocation, index.issuedAt)
  ) {
    return false;
  }
  if (validateRegistryAttestationShape(value.attestation) !== undefined) {
    return false;
  }
  const attestation = value.attestation as RegistryAttestation;
  return (
    attestation.registryId === index.registryId &&
    attestation.publisher === value.publisher &&
    attestation.id === value.id &&
    attestation.version === value.version &&
    attestation.bundleDigest === value.bundleDigest &&
    attestation.publicationSequence === index.publicationSequence &&
    attestation.reviewState === value.trust &&
    attestation.issuedAt === index.issuedAt &&
    attestation.expiresAt === index.expiresAt
  );
}

function validateOrigins(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16)
    return false;
  let previous = "";
  for (const origin of value) {
    if (typeof origin !== "string" || !canonicalHttpsOrigin(origin))
      return false;
    if (previous !== "" && previous >= origin) return false;
    previous = origin;
  }
  return true;
}

function validateTools(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64)
    return false;
  let previous = "";
  for (const tool of value) {
    if (
      !isRecord(tool) ||
      !exactFields(tool, [
        "name",
        ...(tool.title === undefined ? [] : ["title"]),
        "description",
        "risk",
        "permissions",
      ]) ||
      typeof tool.name !== "string" ||
      !TOOL_NAME.test(tool.name) ||
      (tool.title !== undefined && !boundedText(tool.title, 128)) ||
      !boundedText(tool.description, 512) ||
      typeof tool.risk !== "string" ||
      !RISKS.has(tool.risk) ||
      !Array.isArray(tool.permissions) ||
      tool.permissions.length === 0 ||
      tool.permissions.length > PERMISSIONS.size ||
      tool.permissions.some(
        (permission) =>
          typeof permission !== "string" || !PERMISSIONS.has(permission),
      ) ||
      new Set(tool.permissions).size !== tool.permissions.length ||
      (previous !== "" && previous >= tool.name)
    ) {
      return false;
    }
    previous = tool.name;
  }
  return true;
}

function validateCompatibility(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !exactFields(value, ["runtime", "bridgeProtocol"]) ||
    !isRecord(value.runtime) ||
    !exactFields(value.runtime, ["minimum", "maximumExclusive"]) ||
    typeof value.runtime.minimum !== "string" ||
    !SEMVER.test(value.runtime.minimum) ||
    typeof value.runtime.maximumExclusive !== "string" ||
    !SEMVER.test(value.runtime.maximumExclusive) ||
    !isRecord(value.bridgeProtocol) ||
    !exactFields(value.bridgeProtocol, ["minimum", "maximum"])
  ) {
    return false;
  }
  return (
    positiveSafeInteger(value.bridgeProtocol.minimum) &&
    positiveSafeInteger(value.bridgeProtocol.maximum) &&
    value.bridgeProtocol.minimum <= value.bridgeProtocol.maximum
  );
}

function validateNetworkPolicy(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactFields(value, ["extensionRequests"]) &&
    value.extensionRequests === "none"
  );
}

function validateEvidence(value: unknown, issuedAt: unknown): boolean {
  return (
    isRecord(value) &&
    exactFields(value, [
      "verifiedAt",
      "fixtureTestsPassed",
      "fixtureTestsTotal",
      "sourceCommit",
    ]) &&
    isCanonicalTimestamp(value.verifiedAt) &&
    typeof issuedAt === "string" &&
    value.verifiedAt <= issuedAt &&
    nonnegativeSafeInteger(value.fixtureTestsPassed) &&
    positiveSafeInteger(value.fixtureTestsTotal) &&
    value.fixtureTestsPassed === value.fixtureTestsTotal &&
    typeof value.sourceCommit === "string" &&
    GIT_COMMIT.test(value.sourceCommit)
  );
}

function validateRevocation(value: unknown, issuedAt: unknown): boolean {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (value.status === "ACTIVE") return exactFields(value, ["status"]);
  return (
    value.status === "REVOKED" &&
    exactFields(value, ["status", "revokedAt", "reason"]) &&
    isCanonicalTimestamp(value.revokedAt) &&
    typeof issuedAt === "string" &&
    value.revokedAt <= issuedAt &&
    (value.reason === "SECURITY" ||
      value.reason === "PUBLISHER" ||
      value.reason === "SUPERSEDED")
  );
}

function validateIndexSignature(value: unknown, registryId: string): boolean {
  if (
    !isRecord(value) ||
    !exactFields(value, [
      "signatureVersion",
      "algorithm",
      "keyId",
      "signature",
    ]) ||
    value.signatureVersion !== COMMUNITY_REGISTRY_SIGNATURE_VERSION ||
    value.algorithm !== "Ed25519" ||
    typeof value.keyId !== "string" ||
    !KEY_ID.test(value.keyId) ||
    !value.keyId.startsWith(`ed25519:${registryId}:`) ||
    typeof value.signature !== "string" ||
    !BASE64URL.test(value.signature)
  ) {
    return false;
  }
  try {
    return decodeBase64Url(value.signature, "registryIndex").byteLength === 64;
  } catch {
    return false;
  }
}

async function checkedKeys(keys: CommunityRegistrySigningKeys): Promise<{
  readonly privateKey: Uint8Array;
  readonly publicKey: string;
}> {
  const privateKey = keyBytes(keys.privateKey);
  const publicKeyBytes = keyBytes(keys.publicKey);
  if (
    privateKey.byteLength !== 32 ||
    publicKeyBytes.byteLength !== 32 ||
    !bytesEqual(await ed25519.getPublicKeyAsync(privateKey), publicKeyBytes)
  ) {
    throw new TypeError("community registry key pair was rejected");
  }
  return { privateKey, publicKey: encodeBase64Url(publicKeyBytes) };
}

function keyBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string"
    ? decodeBase64Url(value, "communityRegistryKey")
    : value;
}

function validPublicKey(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64URL.test(value)
  ) {
    return false;
  }
  try {
    return decodeBase64Url(value, "publisherKey").byteLength === 32;
  } catch {
    return false;
  }
}

function contentOf(
  index: CommunityRegistryIndexContent | CommunityRegistryIndex,
): CommunityRegistryIndexContent {
  return {
    indexVersion: index.indexVersion,
    registryId: index.registryId,
    publicationSequence: index.publicationSequence,
    issuedAt: index.issuedAt,
    expiresAt: index.expiresAt,
    packs: index.packs,
  };
}

function contentFromRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    indexVersion: value.indexVersion,
    registryId: value.registryId,
    publicationSequence: value.publicationSequence,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    packs: value.packs,
  };
}

function utf8Bytes(value: string | Uint8Array): number {
  return typeof value === "string"
    ? new TextEncoder().encode(value).byteLength
    : value.byteLength;
}

function exactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key)) &&
    fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return descriptor !== undefined && "value" in descriptor;
    })
  );
}

function canonicalHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.origin === value &&
      !value.includes("*")
    );
  } catch {
    return false;
  }
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Array.from(value).length <= maximum
  );
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const CONTENT_FIELDS = [
  "indexVersion",
  "registryId",
  "publicationSequence",
  "issuedAt",
  "expiresAt",
  "packs",
] as const;

const ENTRY_FIELDS = [
  "publisher",
  "id",
  "name",
  "description",
  "version",
  "bundleDigest",
  "bundlePath",
  "publisherKey",
  "trust",
  "origins",
  "tools",
  "compatibility",
  "networkPolicy",
  "verification",
  "revocation",
  "attestation",
] as const;
