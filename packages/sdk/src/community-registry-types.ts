import type {
  PackCompatibility,
  PackNetworkPolicy,
  PackPermission,
  PackRisk,
} from "./types.js";
import type { RegistryAttestation } from "./declarative-bundle-types.js";

export const COMMUNITY_REGISTRY_INDEX_VERSION = 1 as const;
export const COMMUNITY_REGISTRY_SIGNATURE_VERSION = 1 as const;
export const MAX_COMMUNITY_REGISTRY_VERSIONS_PER_PACK = 3;

export type CommunityPackTrust = "OFFICIAL" | "REVIEWED_COMMUNITY";

export type CommunityRegistryToolSummary = Readonly<{
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly risk: PackRisk;
  readonly permissions: readonly PackPermission[];
}>;

export type CommunityRegistryVerificationEvidence = Readonly<{
  readonly verifiedAt: string;
  readonly fixtureTestsPassed: number;
  readonly fixtureTestsTotal: number;
  readonly sourceCommit: string;
}>;

export type CommunityRegistryRevocation =
  | Readonly<{ readonly status: "ACTIVE" }>
  | Readonly<{
      readonly status: "REVOKED";
      readonly revokedAt: string;
      readonly reason: "SECURITY" | "PUBLISHER" | "SUPERSEDED";
    }>;

export type CommunityRegistryPackEntry = Readonly<{
  readonly publisher: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly bundleDigest: string;
  readonly bundlePath: string;
  readonly publisherKey: string;
  readonly trust: CommunityPackTrust;
  readonly origins: readonly string[];
  readonly tools: readonly CommunityRegistryToolSummary[];
  readonly compatibility: PackCompatibility;
  readonly networkPolicy: PackNetworkPolicy;
  readonly verification: CommunityRegistryVerificationEvidence;
  readonly revocation: CommunityRegistryRevocation;
  readonly attestation: RegistryAttestation;
}>;

export type CommunityRegistryIndexContent = Readonly<{
  readonly indexVersion: typeof COMMUNITY_REGISTRY_INDEX_VERSION;
  readonly registryId: string;
  readonly publicationSequence: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly packs: readonly CommunityRegistryPackEntry[];
}>;

export type CommunityRegistryIndexSignature = Readonly<{
  readonly signatureVersion: typeof COMMUNITY_REGISTRY_SIGNATURE_VERSION;
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly signature: string;
}>;

export type CommunityRegistryIndex = CommunityRegistryIndexContent &
  Readonly<{ readonly signature: CommunityRegistryIndexSignature }>;

export type CommunityRegistrySigningKeys = Readonly<{
  readonly privateKey: string | Uint8Array;
  readonly publicKey: string | Uint8Array;
}>;

export type CommunityRegistryVerificationOptions = Readonly<{
  readonly expectedRegistryId: string;
  readonly publicKey: string;
  readonly minimumPublicationSequence?: number;
  readonly now?: Date;
}>;

export type CommunityRegistryVerificationCode =
  | "EXPIRED"
  | "INVALID_INDEX"
  | "INVALID_SIGNATURE"
  | "NOT_YET_VALID"
  | "ROLLBACK";

export type CommunityRegistryVerificationResult =
  | Readonly<{
      readonly ok: true;
      readonly index: CommunityRegistryIndex;
    }>
  | Readonly<{
      readonly ok: false;
      readonly code: CommunityRegistryVerificationCode;
    }>;

export type RegistryAttestationContent = Omit<
  RegistryAttestation,
  "keyId" | "signature"
>;
