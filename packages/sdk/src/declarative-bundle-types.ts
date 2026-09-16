import type { PackManifest } from "./types.js";
import type { DeclarativeOperationsProgram } from "./declarative-operations-types.js";

export const DECLARATIVE_PACK_BUNDLE_VERSION = 1 as const;
export const DECLARATIVE_OPERATIONS_VERSION = 1 as const;
export const BUNDLE_SIGNATURE_VERSION = 1 as const;
export const REGISTRY_ATTESTATION_VERSION = 1 as const;

export type DeclarativePackBundleOperations = Readonly<{
  readonly operationsVersion: typeof DECLARATIVE_OPERATIONS_VERSION;
  readonly program: DeclarativeOperationsProgram;
}>;

export type DeclarativePackBundleMetadata = Readonly<{
  readonly license: string;
  readonly homepage?: string;
  readonly sourceCommit?: string;
}>;

export type PublisherSignatureEnvelope = Readonly<{
  readonly signatureVersion: typeof BUNDLE_SIGNATURE_VERSION;
  readonly algorithm: "Ed25519";
  readonly publisher: string;
  readonly keyId: string;
  readonly publicKey: string;
  readonly signature: string;
}>;

/** Registry membership is independent from publisher authority. */
export type RegistryAttestation = Readonly<{
  readonly attestationVersion: typeof REGISTRY_ATTESTATION_VERSION;
  readonly registryId: string;
  readonly keyId: string;
  readonly publisher: string;
  readonly id: string;
  readonly version: string;
  readonly bundleDigest: string;
  readonly publicationSequence: number;
  readonly reviewState: "OFFICIAL" | "REVIEWED_COMMUNITY";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}>;

export type DeclarativePackBundle = Readonly<{
  readonly bundleVersion: typeof DECLARATIVE_PACK_BUNDLE_VERSION;
  readonly manifest: PackManifest;
  readonly operations: DeclarativePackBundleOperations;
  readonly metadata: DeclarativePackBundleMetadata;
  readonly publisherSignature: PublisherSignatureEnvelope;
  readonly registryAttestation?: RegistryAttestation;
}>;

export type DeclarativePackBundleContent = Readonly<{
  readonly bundleVersion: typeof DECLARATIVE_PACK_BUNDLE_VERSION;
  readonly manifest: PackManifest;
  readonly operations: DeclarativePackBundleOperations;
  readonly metadata: DeclarativePackBundleMetadata;
}>;

export type DeclarativePackBundleValidationCode =
  | "DUPLICATE_KEY"
  | "DUPLICATE_VALUE"
  | "DIGEST_MISMATCH"
  | "IDENTITY_MISMATCH"
  | "INCOMPATIBLE"
  | "INVALID_COMPATIBILITY"
  | "INVALID_BASE64"
  | "INVALID_DIGEST"
  | "INVALID_JSON"
  | "INVALID_SIGNATURE"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "KEY_ID_MISMATCH"
  | "LIMIT_EXCEEDED"
  | "INVALID_IDENTIFIER"
  | "INVALID_ORIGIN"
  | "INVALID_PATH"
  | "INVALID_PERMISSION"
  | "INVALID_REFERENCE"
  | "INVALID_SCHEMA"
  | "INVALID_VERSION"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_VERSION"
  | "INVALID_SELECTOR"
  | "INVALID_PROJECTION"
  | "CONFLICTING_PROJECTION"
  | "DYNAMIC_REFERENCE"
  | "UNBOUNDED_QUERY"
  | "UNSUPPORTED_OPERATION";

export type DeclarativePackBundleValidationIssue = Readonly<{
  readonly code: DeclarativePackBundleValidationCode;
  readonly field: string;
}>;

export class DeclarativePackBundleValidationError extends Error {
  readonly issue: DeclarativePackBundleValidationIssue;

  constructor(issue: DeclarativePackBundleValidationIssue) {
    super(`Declarative pack bundle rejected: ${issue.code} at ${issue.field}`);
    this.name = "DeclarativePackBundleValidationError";
    this.issue = issue;
  }
}

export type BundleCompatibility = Readonly<{
  readonly runtimeVersion: string;
  readonly bridgeProtocolVersion: number;
}>;

export type BundleVerificationResult =
  | Readonly<{ readonly ok: true; readonly bundle: DeclarativePackBundle }>
  | Readonly<{
      readonly ok: false;
      readonly issue: DeclarativePackBundleValidationIssue;
    }>;

export type RegistryVerificationOptions = Readonly<{
  readonly publicKey: string;
  readonly expectedRegistryId: string;
  readonly now?: Date;
}>;

export type PublisherVerificationOptions = Readonly<{
  readonly trustedPublicKey: string;
  readonly runtimeVersion?: string;
  readonly bridgeProtocolVersion?: number;
}>;

export type PublisherSigningKeys = Readonly<{
  readonly privateKey: string | Uint8Array;
  readonly publicKey: string | Uint8Array;
}>;
