import type { PackManifest } from "./types.js";
import {
  DECLARATIVE_OPERATIONS_VERSION,
  DECLARATIVE_PACK_BUNDLE_VERSION,
  BUNDLE_SIGNATURE_VERSION,
  REGISTRY_ATTESTATION_VERSION,
  type DeclarativePackBundleContent,
  type DeclarativePackBundleValidationIssue,
  type RegistryAttestation,
} from "./declarative-bundle-types.js";
import {
  bundleIssue,
  MAX_METADATA_HOMEPAGE_LENGTH,
  MAX_METADATA_LICENSE_LENGTH,
  validateBundleBounds,
  type BundleRecord,
} from "./declarative-bundle-limits.js";
import { decodeBase64Url } from "./declarative-bundle-encoding.js";
import { isRecord } from "./validation/primitives.js";
import { validatePackManifest } from "./validation/manifest.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const KEY_ID = /^ed25519:[a-z][a-z0-9.-]{1,63}:sha256:[a-f0-9]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const REGISTRY_ID = /^[a-z][a-z0-9.-]{1,63}$/u;
const GIT_COMMIT = /^[a-f0-9]{40,64}$/u;
const PUBLISHER = /^[a-z][a-z0-9]*$/u;
const PACK_ID = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/u;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function validateDeclarativePackBundle(
  value: unknown,
): DeclarativePackBundleValidationIssue | undefined {
  const boundsIssue = validateBundleBounds(value);
  if (boundsIssue !== undefined) return safeBoundaryIssue(boundsIssue);
  if (!isRecord(value)) return bundleIssue("INVALID_TYPE", "bundle");
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
  if (unknown !== undefined) return bundleIssue("UNKNOWN_FIELD", "bundle");
  if (value.bundleVersion !== DECLARATIVE_PACK_BUNDLE_VERSION) {
    return bundleIssue("UNSUPPORTED_VERSION", "bundleVersion");
  }
  const manifestIssue = validatePackManifest(value.manifest);
  if (manifestIssue !== undefined) return safeIssue(manifestIssue);
  const manifest = value.manifest as PackManifest;
  if (
    manifest.execution.kind !== "declarative" ||
    manifest.execution.operationsVersion !== DECLARATIVE_OPERATIONS_VERSION
  ) {
    return bundleIssue("INVALID_VALUE", "manifest.execution");
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

export function validateBundleContent(
  value: unknown,
): DeclarativePackBundleValidationIssue | undefined {
  if (!isRecord(value)) return bundleIssue("INVALID_TYPE", "content");
  const unknown = Object.keys(value).find(
    (key) =>
      !["bundleVersion", "manifest", "operations", "metadata"].includes(key),
  );
  if (unknown !== undefined) return bundleIssue("UNKNOWN_FIELD", "content");
  if (value.bundleVersion !== DECLARATIVE_PACK_BUNDLE_VERSION) {
    return bundleIssue("UNSUPPORTED_VERSION", "bundleVersion");
  }
  const manifestIssue = validatePackManifest(value.manifest);
  if (manifestIssue !== undefined) return safeIssue(manifestIssue);
  const manifest = value.manifest as PackManifest;
  if (
    manifest.execution.kind !== "declarative" ||
    manifest.execution.operationsVersion !== DECLARATIVE_OPERATIONS_VERSION
  ) {
    return bundleIssue("INVALID_VALUE", "manifest.execution");
  }
  const operations = value.operations;
  if (!isRecord(operations)) return bundleIssue("INVALID_TYPE", "operations");
  const operationUnknown = Object.keys(operations).find(
    (key) => !["operationsVersion", "program"].includes(key),
  );
  if (operationUnknown !== undefined)
    return bundleIssue("UNKNOWN_FIELD", "operations");
  if (operations.operationsVersion !== DECLARATIVE_OPERATIONS_VERSION) {
    return bundleIssue("UNSUPPORTED_VERSION", "operations.operationsVersion");
  }
  if (operations.program === undefined)
    return bundleIssue("INVALID_VALUE", "operations.program");
  const metadata = value.metadata;
  if (!isRecord(metadata)) return bundleIssue("INVALID_TYPE", "metadata");
  const metadataUnknown = Object.keys(metadata).find(
    (key) => !["license", "homepage", "sourceCommit"].includes(key),
  );
  if (metadataUnknown !== undefined)
    return bundleIssue("UNKNOWN_FIELD", "metadata");
  if (
    typeof metadata.license !== "string" ||
    metadata.license.length === 0 ||
    Array.from(metadata.license).length > MAX_METADATA_LICENSE_LENGTH
  ) {
    return bundleIssue("INVALID_VALUE", "metadata.license");
  }
  if (
    metadata.homepage !== undefined &&
    (typeof metadata.homepage !== "string" ||
      Array.from(metadata.homepage).length > MAX_METADATA_HOMEPAGE_LENGTH ||
      !isCanonicalHomepage(metadata.homepage))
  ) {
    return bundleIssue("INVALID_VALUE", "metadata.homepage");
  }
  if (
    metadata.sourceCommit !== undefined &&
    (typeof metadata.sourceCommit !== "string" ||
      !GIT_COMMIT.test(metadata.sourceCommit))
  ) {
    return bundleIssue("INVALID_VALUE", "metadata.sourceCommit");
  }
  return undefined;
}

export function validatePublisherSignature(
  value: unknown,
  publisher: string,
): DeclarativePackBundleValidationIssue | undefined {
  if (!isRecord(value))
    return bundleIssue("INVALID_TYPE", "publisherSignature");
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
    return bundleIssue("UNKNOWN_FIELD", "publisherSignature");
  if (
    value.signatureVersion !== BUNDLE_SIGNATURE_VERSION ||
    value.algorithm !== "Ed25519"
  ) {
    return bundleIssue(
      "UNSUPPORTED_VERSION",
      "publisherSignature.signatureVersion",
    );
  }
  if (value.publisher !== publisher)
    return bundleIssue("IDENTITY_MISMATCH", "publisherSignature.publisher");
  if (
    typeof value.keyId !== "string" ||
    !KEY_ID.test(value.keyId) ||
    !value.keyId.startsWith("ed25519:" + publisher + ":")
  ) {
    return bundleIssue("KEY_ID_MISMATCH", "publisherSignature.keyId");
  }
  for (const field of ["publicKey", "signature"] as const) {
    if (
      typeof value[field] !== "string" ||
      value[field].length === 0 ||
      !BASE64URL.test(value[field]) ||
      value[field].length % 4 === 1
    ) {
      return bundleIssue("INVALID_BASE64", "publisherSignature");
    }
  }
  try {
    if (
      decodeBase64Url(value.publicKey, "publisherSignature").byteLength !== 32
    ) {
      return bundleIssue("INVALID_VALUE", "publisherSignature");
    }
    if (
      decodeBase64Url(value.signature, "publisherSignature").byteLength !== 64
    ) {
      return bundleIssue("INVALID_VALUE", "publisherSignature");
    }
  } catch {
    return bundleIssue("INVALID_BASE64", "publisherSignature");
  }
  return undefined;
}

export function validateRegistryAttestationShape(
  value: unknown,
): DeclarativePackBundleValidationIssue | undefined {
  if (!isRecord(value))
    return bundleIssue("INVALID_TYPE", "registryAttestation");
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
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    return bundleIssue("UNKNOWN_FIELD", "registryAttestation");
  }
  if (value.attestationVersion !== REGISTRY_ATTESTATION_VERSION) {
    return bundleIssue(
      "UNSUPPORTED_VERSION",
      "registryAttestation.attestationVersion",
    );
  }
  if (
    typeof value.registryId !== "string" ||
    !REGISTRY_ID.test(value.registryId)
  )
    return bundleIssue("INVALID_VALUE", "registryAttestation.registryId");
  if (
    typeof value.keyId !== "string" ||
    !KEY_ID.test(value.keyId) ||
    !value.keyId.startsWith("ed25519:" + value.registryId + ":")
  )
    return bundleIssue("KEY_ID_MISMATCH", "registryAttestation.keyId");
  if (typeof value.publisher !== "string" || !PUBLISHER.test(value.publisher))
    return bundleIssue("INVALID_VALUE", "registryAttestation.publisher");
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 64 ||
    !PACK_ID.test(value.id)
  )
    return bundleIssue("INVALID_VALUE", "registryAttestation.id");
  if (
    typeof value.version !== "string" ||
    value.version.length === 0 ||
    value.version.length > 64 ||
    !SEMVER.test(value.version)
  )
    return bundleIssue("INVALID_VALUE", "registryAttestation.version");
  if (
    typeof value.bundleDigest !== "string" ||
    !DIGEST.test(value.bundleDigest)
  )
    return bundleIssue("INVALID_DIGEST", "registryAttestation.bundleDigest");
  if (
    typeof value.publicationSequence !== "number" ||
    !Number.isSafeInteger(value.publicationSequence) ||
    value.publicationSequence < 1
  )
    return bundleIssue(
      "INVALID_VALUE",
      "registryAttestation.publicationSequence",
    );
  if (
    value.reviewState !== "OFFICIAL" &&
    value.reviewState !== "REVIEWED_COMMUNITY"
  )
    return bundleIssue("INVALID_VALUE", "registryAttestation.reviewState");
  if (!isCanonicalTimestamp(value.issuedAt))
    return bundleIssue("INVALID_VALUE", "registryAttestation.issuedAt");
  if (
    !isCanonicalTimestamp(value.expiresAt) ||
    value.issuedAt >= value.expiresAt
  )
    return bundleIssue("INVALID_VALUE", "registryAttestation.expiresAt");
  try {
    if (
      decodeBase64Url(value.signature, "registryAttestation").byteLength !== 64
    )
      return bundleIssue("INVALID_VALUE", "registryAttestation");
  } catch {
    return bundleIssue("INVALID_BASE64", "registryAttestation");
  }
  return undefined;
}

function validateRegistryAttestation(
  value: unknown,
  manifest: PackManifest,
): DeclarativePackBundleValidationIssue | undefined {
  const shapeIssue = validateRegistryAttestationShape(value);
  if (shapeIssue !== undefined) return shapeIssue;
  const attestation = value as RegistryAttestation;
  if (
    attestation.publisher !== manifest.publisher ||
    attestation.id !== manifest.id ||
    attestation.version !== manifest.version
  )
    return bundleIssue("IDENTITY_MISMATCH", "registryAttestation");
  return attestation.bundleDigest === manifest.digest
    ? undefined
    : bundleIssue("IDENTITY_MISMATCH", "registryAttestation.bundleDigest");
}

export function isCanonicalHomepage(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.port !== "" ||
      !url.hostname.includes(".") ||
      url.hostname
        .split(".")
        .some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)) ||
      /%[0-9a-f]{2}/iu.test(url.pathname + url.search)
    )
      return false;
    const canonical =
      url.origin + (url.pathname === "/" ? "" : url.pathname) + url.search;
    return value === canonical;
  } catch {
    return false;
  }
}

export function isCanonicalTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function contentOf(value: BundleRecord): DeclarativePackBundleContent {
  return {
    bundleVersion: value.bundleVersion as 1,
    manifest: value.manifest as PackManifest,
    operations: value.operations as DeclarativePackBundleContent["operations"],
    metadata: value.metadata as DeclarativePackBundleContent["metadata"],
  };
}

function safeIssue(issue: {
  readonly code: string;
  readonly field: string;
}): DeclarativePackBundleValidationIssue {
  return {
    code: issue.code as DeclarativePackBundleValidationIssue["code"],
    field: "manifest",
  };
}

function safeBoundaryIssue(issue: {
  readonly code: string;
}): DeclarativePackBundleValidationIssue {
  return {
    code: issue.code as DeclarativePackBundleValidationIssue["code"],
    field: "bundle",
  };
}
