import canonicalize from "canonicalize";
import * as ed25519 from "@noble/ed25519";

import {
  packSupportsBridgeProtocol,
  packSupportsRuntime,
} from "./pack-compatibility.js";
import type { PackManifest } from "./types.js";
import {
  BUNDLE_SIGNATURE_VERSION,
  DECLARATIVE_OPERATIONS_VERSION,
  DECLARATIVE_PACK_BUNDLE_VERSION,
  REGISTRY_ATTESTATION_VERSION,
  type BundleVerificationResult,
  type DeclarativePackBundle,
  type DeclarativePackBundleContent,
  type DeclarativePackBundleValidationCode,
  type DeclarativePackBundleValidationIssue,
  DeclarativePackBundleValidationError,
  type PublisherSignatureEnvelope,
  type PublisherSigningKeys,
  type PublisherVerificationOptions,
  type RegistryAttestation,
  type RegistryVerificationOptions,
} from "./declarative-bundle-types.js";
import { parseStrictJson } from "./strict-json.js";
import {
  cloneAndFreeze,
  isRecord,
  validateJsonBounds,
} from "./validation/primitives.js";
import { validatePackManifest } from "./validation/manifest.js";

export const MAX_DECLARATIVE_BUNDLE_BYTES = 1024 * 1024;
export const MAX_BUNDLE_STRING_BYTES = 16 * 1024;
export const MAX_BUNDLE_ARRAY_ITEMS = 512;
export const MAX_BUNDLE_OBJECT_FIELDS = 256;
export const MAX_BUNDLE_JSON_DEPTH = 32;
export const MAX_BUNDLE_JSON_NODES = 8_192;

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const KEY_ID = /^ed25519:[a-z][a-z0-9.-]{1,63}:sha256:[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const REGISTRY_ID = /^[a-z][a-z0-9.-]{1,63}$/;
const GIT_COMMIT = /^[a-f0-9]{40,64}$/;
const DOMAIN_DIGEST = "MCPatch declarative pack bundle digest\0bundle=1\0";
const DOMAIN_SIGNATURE =
  "MCPatch declarative pack bundle signature\0bundle=1\0";
const DOMAIN_REGISTRY =
  "MCPatch declarative pack registry attestation\0attestation=1\0";

type RecordValue = Record<string, unknown>;
const jcs = canonicalize as unknown as (value: unknown) => string | undefined;

export function validateDeclarativePackBundle(
  value: unknown,
): DeclarativePackBundleValidationIssue | undefined {
  const boundsIssue = validateBundleBounds(value);
  if (boundsIssue !== undefined) return boundsIssue;
  if (!isRecord(value)) return issue("INVALID_TYPE", "$");
  const unknown = Object.keys(value).find(
    (key) =>
      ![
        "bundleVersion",
        "manifest",
        "operations",
        "metadata",
        "publisherSignature",
        "registryAttestation",
      ].includes(key),
  );
  if (unknown !== undefined) return issue("UNKNOWN_FIELD", "$." + unknown);
  if (value.bundleVersion !== DECLARATIVE_PACK_BUNDLE_VERSION) {
    return issue("UNSUPPORTED_VERSION", "bundleVersion");
  }
  const manifestIssue = validatePackManifest(value.manifest);
  if (manifestIssue !== undefined) return manifestIssue;
  const manifest = value.manifest as PackManifest;
  if (
    manifest.execution.kind !== "declarative" ||
    manifest.execution.operationsVersion !== DECLARATIVE_OPERATIONS_VERSION
  ) {
    return issue("INVALID_VALUE", "manifest.execution");
  }
  const contentIssue = validateBundleContent(contentOf(value));
  if (contentIssue !== undefined) return contentIssue;
  const signatureIssue = validatePublisherSignature(
    value.publisherSignature,
    manifest.publisher,
  );
  if (signatureIssue !== undefined) return signatureIssue;
  if (value.registryAttestation !== undefined) {
    const attestationIssue = validateRegistryAttestation(
      value.registryAttestation,
      manifest,
    );
    if (attestationIssue !== undefined) return attestationIssue;
  }
  return undefined;
}

export function parseDeclarativePackBundle(
  value: unknown,
): DeclarativePackBundle {
  const validationIssue = validateDeclarativePackBundle(value);
  if (validationIssue !== undefined) {
    throw new DeclarativePackBundleValidationError(validationIssue);
  }
  return cloneAndFreeze(value) as DeclarativePackBundle;
}

export function decodeDeclarativePackBundle(
  input: string | Uint8Array,
): unknown {
  const bytes = typeof input === "string" ? encodeUtf8(input) : input;
  if (bytes.byteLength > MAX_DECLARATIVE_BUNDLE_BYTES) {
    throw new DeclarativePackBundleValidationError(
      issue("LIMIT_EXCEEDED", "$"),
    );
  }
  return parseStrictJson(bytes);
}

export function parseDeclarativePackBundleBytes(
  input: string | Uint8Array,
): DeclarativePackBundle {
  return parseDeclarativePackBundle(decodeDeclarativePackBundle(input));
}

/** Returns the exact UTF-8 JCS bytes of the complete .mcpack document. */
export function serializeDeclarativePackBundle(
  bundle: DeclarativePackBundle,
): Uint8Array {
  const checked = parseDeclarativePackBundle(bundle);
  const bytes = encodeUtf8(canonicalizeOrThrow(checked));
  if (bytes.byteLength > MAX_DECLARATIVE_BUNDLE_BYTES) {
    throw new DeclarativePackBundleValidationError(
      issue("LIMIT_EXCEEDED", "$"),
    );
  }
  return bytes;
}

export function canonicalizeDeclarativePackBundle(
  bundle: DeclarativePackBundle,
): string {
  return decodeUtf8(serializeDeclarativePackBundle(bundle));
}

/** Computes a domain-separated digest over the explicit digest-free content payload. */
export async function computeDeclarativePackBundleDigest(
  bundle: DeclarativePackBundleContent | DeclarativePackBundle,
): Promise<string> {
  const content =
    "publisherSignature" in bundle
      ? contentOf(bundle as unknown as RecordValue)
      : bundle;
  const contentIssue = validateBundleContent(content);
  if (contentIssue !== undefined) {
    throw new DeclarativePackBundleValidationError(contentIssue);
  }
  const bytes = encodeUtf8(canonicalizeOrThrow(digestPayload(content)));
  const digest = await cryptoApi().subtle.digest(
    "SHA-256",
    toCryptoBuffer(concat(encodeUtf8(DOMAIN_DIGEST), bytes)),
  );
  return "sha256:" + toHex(digest);
}

export async function publisherKeyId(
  publisher: string,
  publicKey: string,
): Promise<string> {
  const bytes = decodeBase64Url(publicKey, "publicKey");
  if (bytes.byteLength !== 32) {
    throw new DeclarativePackBundleValidationError(
      issue("INVALID_BASE64", "publicKey"),
    );
  }
  const digest = await cryptoApi().subtle.digest(
    "SHA-256",
    toCryptoBuffer(bytes),
  );
  return "ed25519:" + publisher + ":sha256:" + toHex(digest);
}

export async function signDeclarativePackBundle(
  bundle: DeclarativePackBundleContent,
  keys: PublisherSigningKeys,
): Promise<DeclarativePackBundle> {
  const contentIssue = validateBundleContent(bundle);
  if (contentIssue !== undefined) {
    throw new DeclarativePackBundleValidationError(contentIssue);
  }
  const digest = await computeDeclarativePackBundleDigest(bundle);
  if (bundle.manifest.digest !== digest) {
    throw new DeclarativePackBundleValidationError(
      issue("DIGEST_MISMATCH", "manifest.digest"),
    );
  }
  const publicKeyBytes = keyBytes(keys.publicKey, "publicKey");
  if (publicKeyBytes.byteLength !== 32) {
    throw new DeclarativePackBundleValidationError(
      issue("INVALID_BASE64", "publicKey"),
    );
  }
  const privateKeyBytes = keyBytes(keys.privateKey, "privateKey");
  if (privateKeyBytes.byteLength !== 32) {
    throw new DeclarativePackBundleValidationError(
      issue("INVALID_BASE64", "privateKey"),
    );
  }
  if (
    !bytesEqual(
      await ed25519.getPublicKeyAsync(privateKeyBytes),
      publicKeyBytes,
    )
  ) {
    throw new DeclarativePackBundleValidationError(
      issue("KEY_ID_MISMATCH", "publicKey"),
    );
  }
  const publicKey = encodeBase64Url(publicKeyBytes);
  const envelope: PublisherSignatureEnvelope = {
    algorithm: "Ed25519",
    keyId: await publisherKeyId(bundle.manifest.publisher, publicKey),
    publisher: bundle.manifest.publisher,
    publicKey,
    signature: encodeBase64Url(
      new Uint8Array(
        await ed25519.signAsync(signingBytes(bundle, digest), privateKeyBytes),
      ),
    ),
    signatureVersion: BUNDLE_SIGNATURE_VERSION,
  };
  return parseDeclarativePackBundle({
    ...bundle,
    publisherSignature: envelope,
  });
}

export async function verifyDeclarativePackBundle(
  bundle: DeclarativePackBundle,
  options?: PublisherVerificationOptions,
): Promise<BundleVerificationResult> {
  const validationIssue = validateDeclarativePackBundle(bundle);
  if (validationIssue !== undefined)
    return { ok: false, issue: validationIssue };
  const checked = parseDeclarativePackBundle(bundle);
  if (
    options?.runtimeVersion !== undefined &&
    !packSupportsRuntime(checked.manifest, options.runtimeVersion)
  ) {
    return {
      ok: false,
      issue: issue("INCOMPATIBLE", "manifest.compatibility.runtime"),
    };
  }
  if (
    options?.bridgeProtocolVersion !== undefined &&
    !packSupportsBridgeProtocol(checked.manifest, options.bridgeProtocolVersion)
  ) {
    return {
      ok: false,
      issue: issue("INCOMPATIBLE", "manifest.compatibility.bridgeProtocol"),
    };
  }
  if (options === undefined) {
    return {
      ok: false,
      issue: issue("INVALID_SIGNATURE", "publisherSignature"),
    };
  }
  const digest = await computeDeclarativePackBundleDigest(checked);
  if (digest !== checked.manifest.digest) {
    return { ok: false, issue: issue("DIGEST_MISMATCH", "manifest.digest") };
  }
  const signature = checked.publisherSignature;
  if (signature.publisher !== checked.manifest.publisher) {
    return {
      ok: false,
      issue: issue("IDENTITY_MISMATCH", "publisherSignature.publisher"),
    };
  }
  if (signature.publicKey !== options.trustedPublicKey) {
    return {
      ok: false,
      issue: issue("KEY_ID_MISMATCH", "publisherSignature.publicKey"),
    };
  }
  if (
    (await publisherKeyId(
      checked.manifest.publisher,
      options.trustedPublicKey,
    )) !== signature.keyId
  ) {
    return {
      ok: false,
      issue: issue("KEY_ID_MISMATCH", "publisherSignature.keyId"),
    };
  }
  try {
    const valid = await ed25519.verifyAsync(
      decodeBase64Url(signature.signature, "publisherSignature.signature"),
      signingBytes(checked, digest),
      decodeBase64Url(options.trustedPublicKey, "trustedPublicKey"),
    );
    return valid
      ? { ok: true, bundle: checked }
      : {
          ok: false,
          issue: issue("INVALID_SIGNATURE", "publisherSignature.signature"),
        };
  } catch {
    return {
      ok: false,
      issue: issue("INVALID_SIGNATURE", "publisherSignature.signature"),
    };
  }
}

export async function verifyRegistryAttestation(
  attestation: RegistryAttestation,
  options: RegistryVerificationOptions,
): Promise<boolean> {
  const bytes = decodeBase64Url(
    attestation.signature,
    "registryAttestation.signature",
  );
  if (bytes.byteLength !== 64) return false;
  if (
    options.expectedRegistryId !== undefined &&
    attestation.registryId !== options.expectedRegistryId
  ) {
    return false;
  }
  if (
    (await publisherKeyId(attestation.registryId, options.publicKey)) !==
    attestation.keyId
  ) {
    return false;
  }
  const valid = await ed25519.verifyAsync(
    bytes,
    registryAttestationSigningBytes(attestation),
    decodeBase64Url(options.publicKey, "publicKey"),
  );
  const now = options.now?.getTime() ?? Date.now();
  return (
    valid &&
    Date.parse(attestation.issuedAt) <= now &&
    now < Date.parse(attestation.expiresAt)
  );
}

/** Returns the independent registry-domain bytes covered by an attestation. */
export function registryAttestationSigningBytes(
  attestation: RegistryAttestation,
): Uint8Array {
  const statement = {
    attestationVersion: attestation.attestationVersion,
    bundleDigest: attestation.bundleDigest,
    expiresAt: attestation.expiresAt,
    id: attestation.id,
    issuedAt: attestation.issuedAt,
    publisher: attestation.publisher,
    registryId: attestation.registryId,
    version: attestation.version,
    publicationSequence: attestation.publicationSequence,
    reviewState: attestation.reviewState,
  };
  return concat(
    encodeUtf8(DOMAIN_REGISTRY),
    encodeUtf8(canonicalizeOrThrow(statement)),
  );
}

function digestPayload(bundle: DeclarativePackBundleContent): RecordValue {
  const manifest = { ...bundle.manifest } as RecordValue;
  Reflect.deleteProperty(manifest, "digest");
  return {
    bundleVersion: bundle.bundleVersion,
    manifest,
    metadata: bundle.metadata,
    operations: bundle.operations,
  };
}

function signingBytes(
  bundle: DeclarativePackBundleContent,
  digest: string,
): Uint8Array {
  return concat(
    encodeUtf8(DOMAIN_SIGNATURE),
    encodeUtf8(canonicalizeOrThrow({ digest, payload: digestPayload(bundle) })),
  );
}

function validateBundleContent(
  value: unknown,
): DeclarativePackBundleValidationIssue | undefined {
  if (!isRecord(value)) return issue("INVALID_TYPE", "$");
  const unknown = Object.keys(value).find(
    (key) =>
      !["bundleVersion", "manifest", "operations", "metadata"].includes(key),
  );
  if (unknown !== undefined) return issue("UNKNOWN_FIELD", "$." + unknown);
  if (value.bundleVersion !== DECLARATIVE_PACK_BUNDLE_VERSION) {
    return issue("UNSUPPORTED_VERSION", "bundleVersion");
  }
  const manifestIssue = validatePackManifest(value.manifest);
  if (manifestIssue !== undefined) return manifestIssue;
  const manifest = value.manifest as PackManifest;
  if (
    manifest.execution.kind !== "declarative" ||
    manifest.execution.operationsVersion !== DECLARATIVE_OPERATIONS_VERSION
  ) {
    return issue("INVALID_VALUE", "manifest.execution");
  }
  const operations = value.operations;
  if (!isRecord(operations)) return issue("INVALID_TYPE", "operations");
  const operationUnknown = Object.keys(operations).find(
    (key) => !["operationsVersion", "program"].includes(key),
  );
  if (operationUnknown !== undefined)
    return issue("UNKNOWN_FIELD", "operations." + operationUnknown);
  if (operations.operationsVersion !== DECLARATIVE_OPERATIONS_VERSION) {
    return issue("UNSUPPORTED_VERSION", "operations.operationsVersion");
  }
  if (operations.program === undefined)
    return issue("INVALID_VALUE", "operations.program");
  const metadata = value.metadata;
  if (!isRecord(metadata)) return issue("INVALID_TYPE", "metadata");
  const metadataUnknown = Object.keys(metadata).find(
    (key) => !["license", "homepage", "sourceCommit"].includes(key),
  );
  if (metadataUnknown !== undefined)
    return issue("UNKNOWN_FIELD", "metadata." + metadataUnknown);
  if (typeof metadata.license !== "string" || metadata.license.length === 0) {
    return issue("INVALID_VALUE", "metadata.license");
  }
  if (
    metadata.homepage !== undefined &&
    (typeof metadata.homepage !== "string" ||
      !/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/u.test(metadata.homepage))
  ) {
    return issue("INVALID_VALUE", "metadata.homepage");
  }
  if (
    metadata.sourceCommit !== undefined &&
    (typeof metadata.sourceCommit !== "string" ||
      !GIT_COMMIT.test(metadata.sourceCommit))
  ) {
    return issue("INVALID_VALUE", "metadata.sourceCommit");
  }
  return undefined;
}

function contentOf(value: RecordValue): DeclarativePackBundleContent {
  return {
    bundleVersion: value.bundleVersion as 1,
    manifest: value.manifest as PackManifest,
    operations: value.operations as DeclarativePackBundleContent["operations"],
    metadata: value.metadata as DeclarativePackBundleContent["metadata"],
  };
}

function validateBundleBounds(
  value: unknown,
): DeclarativePackBundleValidationIssue | undefined {
  const manifestBounds = validateJsonBounds(value);
  if (manifestBounds !== undefined) {
    return manifestBounds as DeclarativePackBundleValidationIssue;
  }
  let nodes = 0;
  const stack: Array<{
    readonly value: unknown;
    readonly depth: number;
    readonly field: string;
  }> = [{ value, depth: 0, field: "$" }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    nodes += 1;
    if (
      nodes > MAX_BUNDLE_JSON_NODES ||
      current.depth > MAX_BUNDLE_JSON_DEPTH
    ) {
      return issue("LIMIT_EXCEEDED", current.field);
    }
    if (typeof current.value === "string") {
      if (!isWellFormed(current.value) || hasNoncharacter(current.value)) {
        return issue("INVALID_VALUE", current.field);
      }
      if (
        new TextEncoder().encode(current.value).byteLength >
        MAX_BUNDLE_STRING_BYTES
      ) {
        return issue("LIMIT_EXCEEDED", current.field);
      }
    } else if (typeof current.value === "number") {
      if (
        !Number.isSafeInteger(current.value) ||
        Object.is(current.value, -0)
      ) {
        return issue("INVALID_VALUE", current.field);
      }
    } else if (Array.isArray(current.value)) {
      if (current.value.length > MAX_BUNDLE_ARRAY_ITEMS) {
        return issue("LIMIT_EXCEEDED", current.field);
      }
      for (let index = 0; index < current.value.length; index += 1) {
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
          field: current.field + "[" + index + "]",
        });
      }
    } else if (isRecord(current.value)) {
      const keys = Object.keys(current.value);
      if (keys.length > MAX_BUNDLE_OBJECT_FIELDS) {
        return issue("LIMIT_EXCEEDED", current.field);
      }
      for (const key of keys) {
        stack.push({
          value: current.value[key],
          depth: current.depth + 1,
          field: current.field + "." + key,
        });
      }
    }
  }
  return undefined;
}

function validatePublisherSignature(
  value: unknown,
  publisher: string,
): DeclarativePackBundleValidationIssue | undefined {
  if (!isRecord(value)) return issue("INVALID_TYPE", "publisherSignature");
  const unknown = Object.keys(value).find(
    (key) =>
      ![
        "signatureVersion",
        "algorithm",
        "publisher",
        "keyId",
        "publicKey",
        "signature",
      ].includes(key),
  );
  if (unknown !== undefined)
    return issue("UNKNOWN_FIELD", "publisherSignature." + unknown);
  if (
    value.signatureVersion !== BUNDLE_SIGNATURE_VERSION ||
    value.algorithm !== "Ed25519"
  ) {
    return issue("UNSUPPORTED_VERSION", "publisherSignature.signatureVersion");
  }
  if (value.publisher !== publisher) {
    return issue("IDENTITY_MISMATCH", "publisherSignature.publisher");
  }
  if (typeof value.keyId !== "string" || !KEY_ID.test(value.keyId)) {
    return issue("INVALID_VALUE", "publisherSignature.keyId");
  }
  if (!value.keyId.startsWith("ed25519:" + publisher + ":")) {
    return issue("KEY_ID_MISMATCH", "publisherSignature.keyId");
  }
  for (const field of ["publicKey", "signature"] as const) {
    if (
      typeof value[field] !== "string" ||
      value[field].length === 0 ||
      !BASE64URL.test(value[field]) ||
      value[field].length % 4 === 1
    ) {
      return issue("INVALID_BASE64", "publisherSignature." + field);
    }
  }
  try {
    if (
      decodeBase64Url(value.publicKey, "publisherSignature.publicKey")
        .byteLength !== 32
    ) {
      return issue("INVALID_VALUE", "publisherSignature.publicKey");
    }
    if (
      decodeBase64Url(value.signature, "publisherSignature.signature")
        .byteLength !== 64
    ) {
      return issue("INVALID_VALUE", "publisherSignature.signature");
    }
  } catch {
    return issue("INVALID_BASE64", "publisherSignature");
  }
  return undefined;
}

function validateRegistryAttestation(
  value: unknown,
  manifest: PackManifest,
): DeclarativePackBundleValidationIssue | undefined {
  if (!isRecord(value)) return issue("INVALID_TYPE", "registryAttestation");
  const fields = [
    "attestationVersion",
    "registryId",
    "keyId",
    "publisher",
    "id",
    "version",
    "bundleDigest",
    "publicationSequence",
    "reviewState",
    "issuedAt",
    "expiresAt",
    "signature",
  ];
  const unknown = Object.keys(value).find((key) => !fields.includes(key));
  if (unknown !== undefined)
    return issue("UNKNOWN_FIELD", "registryAttestation." + unknown);
  if (value.attestationVersion !== REGISTRY_ATTESTATION_VERSION) {
    return issue(
      "UNSUPPORTED_VERSION",
      "registryAttestation.attestationVersion",
    );
  }
  if (
    typeof value.registryId !== "string" ||
    !REGISTRY_ID.test(value.registryId)
  ) {
    return issue("INVALID_VALUE", "registryAttestation.registryId");
  }
  if (typeof value.keyId !== "string" || !KEY_ID.test(value.keyId)) {
    return issue("INVALID_VALUE", "registryAttestation.keyId");
  }
  if (
    value.publisher !== manifest.publisher ||
    value.id !== manifest.id ||
    value.version !== manifest.version
  ) {
    return issue("IDENTITY_MISMATCH", "registryAttestation");
  }
  if (
    typeof value.bundleDigest !== "string" ||
    value.bundleDigest !== manifest.digest ||
    !DIGEST.test(value.bundleDigest)
  ) {
    return issue("IDENTITY_MISMATCH", "registryAttestation.bundleDigest");
  }
  if (
    typeof value.publicationSequence !== "number" ||
    !Number.isSafeInteger(value.publicationSequence) ||
    value.publicationSequence < 1
  ) {
    return issue("INVALID_VALUE", "registryAttestation.publicationSequence");
  }
  if (
    value.reviewState !== "OFFICIAL" &&
    value.reviewState !== "REVIEWED_COMMUNITY"
  ) {
    return issue("INVALID_VALUE", "registryAttestation.reviewState");
  }
  if (
    typeof value.issuedAt !== "string" ||
    Number.isNaN(Date.parse(value.issuedAt))
  ) {
    return issue("INVALID_VALUE", "registryAttestation.issuedAt");
  }
  if (
    typeof value.expiresAt !== "string" ||
    Number.isNaN(Date.parse(value.expiresAt)) ||
    Date.parse(value.issuedAt) >= Date.parse(value.expiresAt)
  ) {
    return issue("INVALID_VALUE", "registryAttestation.expiresAt");
  }
  return typeof value.signature === "string" &&
    BASE64URL.test(value.signature) &&
    value.signature.length % 4 !== 1
    ? undefined
    : issue("INVALID_BASE64", "registryAttestation.signature");
}

function canonicalizeOrThrow(value: unknown): string {
  try {
    const result = jcs(value);
    if (result === undefined) throw new Error("not JSON");
    return result;
  } catch {
    throw new DeclarativePackBundleValidationError(issue("INVALID_VALUE", "$"));
  }
}

function cryptoApi(): Crypto {
  if (globalThis.crypto === undefined)
    throw new Error("Web Crypto is unavailable");
  return globalThis.crypto;
}

function encodeUtf8(value: string): Uint8Array {
  if (!isWellFormed(value) || hasNoncharacter(value)) {
    throw new DeclarativePackBundleValidationError(issue("INVALID_VALUE", "$"));
  }
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new DeclarativePackBundleValidationError(issue("INVALID_JSON", "$"));
  }
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function toCryptoBuffer(value: Uint8Array): BufferSource {
  return value as unknown as BufferSource;
}

function keyBytes(value: string | Uint8Array, field: string): Uint8Array {
  return typeof value === "string" ? decodeBase64Url(value, field) : value;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: unknown, field: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64URL.test(value) ||
    value.length % 4 === 1
  ) {
    throw new DeclarativePackBundleValidationError(
      issue("INVALID_BASE64", field),
    );
  }
  try {
    const binary = atob(
      value.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat((4 - (value.length % 4)) % 4),
    );
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (encodeBase64Url(bytes) !== value) {
      throw new Error("noncanonical base64url");
    }
    return bytes;
  } catch {
    throw new DeclarativePackBundleValidationError(
      issue("INVALID_BASE64", field),
    );
  }
}

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function hasNoncharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
        (codePoint & 0xffff) >= 0xfffe)
    ) {
      return true;
    }
  }
  return false;
}

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function issue(
  code: DeclarativePackBundleValidationCode,
  field: string,
): DeclarativePackBundleValidationIssue {
  return { code, field };
}
