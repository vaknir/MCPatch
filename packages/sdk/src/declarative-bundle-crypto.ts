import * as ed25519 from "@noble/ed25519";

import type {
  DeclarativePackBundle,
  DeclarativePackBundleContent,
  PublisherSignatureEnvelope,
  PublisherSigningKeys,
  PublisherVerificationOptions,
  RegistryAttestation,
  RegistryVerificationOptions,
} from "./declarative-bundle-types.js";
import { BUNDLE_SIGNATURE_VERSION } from "./declarative-bundle-types.js";
import {
  DOMAIN_DIGEST,
  DOMAIN_REGISTRY,
  canonicalizeOrThrow,
  concat,
  digestPayload,
  encodeUtf8,
  signingBytes,
  sha256,
  toHex,
} from "./declarative-bundle-canonical.js";
import {
  decodeBase64Url,
  encodeBase64Url,
} from "./declarative-bundle-encoding.js";
import { bundleIssue, bytesEqual } from "./declarative-bundle-limits.js";
import type { DeclarativePackBundleValidationIssue } from "./declarative-bundle-types.js";

export async function computeDigest(
  content: DeclarativePackBundleContent,
): Promise<string> {
  const bytes = encodeUtf8(canonicalizeOrThrow(digestPayload(content)));
  return (
    "sha256:" + toHex(await sha256(concat(encodeUtf8(DOMAIN_DIGEST), bytes)))
  );
}

export async function publisherKeyId(
  publisher: string,
  publicKey: string,
): Promise<string> {
  const bytes = decodeBase64Url(publicKey, "publicKey");
  if (bytes.byteLength !== 32) {
    throw new Error("invalid publisher key");
  }
  return "ed25519:" + publisher + ":sha256:" + toHex(await sha256(bytes));
}

export async function signBundle(
  content: DeclarativePackBundleContent,
  keys: PublisherSigningKeys,
): Promise<DeclarativePackBundle> {
  const publicKeyBytes = keyBytes(keys.publicKey);
  const privateKeyBytes = keyBytes(keys.privateKey);
  if (
    publicKeyBytes.byteLength !== 32 ||
    privateKeyBytes.byteLength !== 32 ||
    !bytesEqual(
      await ed25519.getPublicKeyAsync(privateKeyBytes),
      publicKeyBytes,
    )
  )
    throw new Error("invalid publisher key pair");
  const digest = await computeDigest(content);
  if (content.manifest.digest !== digest)
    throw new Error("content digest mismatch");
  const publicKey = encodeBase64Url(publicKeyBytes);
  const envelope: PublisherSignatureEnvelope = {
    algorithm: "Ed25519",
    keyId: await publisherKeyId(content.manifest.publisher, publicKey),
    publisher: content.manifest.publisher,
    publicKey,
    signature: encodeBase64Url(
      await ed25519.signAsync(signingBytes(content, digest), privateKeyBytes),
    ),
    signatureVersion: BUNDLE_SIGNATURE_VERSION,
  };
  return { ...content, publisherSignature: envelope };
}

export async function verifyPublisherSignature(
  bundle: DeclarativePackBundle,
  options: PublisherVerificationOptions,
  digest: string,
): Promise<DeclarativePackBundleValidationIssue | undefined> {
  const signature = bundle.publisherSignature;
  if (signature.publicKey !== options.trustedPublicKey) {
    return bundleIssue("KEY_ID_MISMATCH", "publisherSignature");
  }
  try {
    if (
      (await publisherKeyId(
        bundle.manifest.publisher,
        options.trustedPublicKey,
      )) !== signature.keyId
    )
      return bundleIssue("KEY_ID_MISMATCH", "publisherSignature");
    const valid = await ed25519.verifyAsync(
      decodeBase64Url(signature.signature, "publisherSignature"),
      signingBytes(bundle, digest),
      decodeBase64Url(options.trustedPublicKey, "trustedPublicKey"),
      { zip215: false },
    );
    return valid
      ? undefined
      : bundleIssue("INVALID_SIGNATURE", "publisherSignature");
  } catch {
    return bundleIssue("INVALID_SIGNATURE", "publisherSignature");
  }
}

export async function verifyRegistrySignature(
  attestation: RegistryAttestation,
  options: RegistryVerificationOptions,
): Promise<boolean> {
  try {
    if (
      (await publisherKeyId(attestation.registryId, options.publicKey)) !==
      attestation.keyId
    )
      return false;
    return await ed25519.verifyAsync(
      decodeBase64Url(attestation.signature, "registryAttestation"),
      registryAttestationSigningBytes(attestation),
      decodeBase64Url(options.publicKey, "registryAttestation"),
      { zip215: false },
    );
  } catch {
    return false;
  }
}

export function registryAttestationSigningBytes(
  attestation: RegistryAttestation,
): Uint8Array {
  return concat(
    encodeUtf8(DOMAIN_REGISTRY),
    encodeUtf8(
      canonicalizeOrThrow({
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
      }),
    ),
  );
}

function keyBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string"
    ? decodeBase64Url(value, "publisherKey")
    : value;
}
