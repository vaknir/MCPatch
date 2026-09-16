import {
  packSupportsBridgeProtocol,
  packSupportsRuntime,
} from "./pack-compatibility.js";
import { cloneAndFreeze } from "./validation/primitives.js";
import type {
  BundleVerificationResult,
  DeclarativePackBundle,
  DeclarativePackBundleContent,
  PublisherSigningKeys,
  PublisherVerificationOptions,
  RegistryAttestation,
  RegistryVerificationOptions,
} from "./declarative-bundle-types.js";
import { DeclarativePackBundleValidationError } from "./declarative-bundle-types.js";
import {
  canonicalizeOrThrow,
  decodeUtf8,
  encodeUtf8,
} from "./declarative-bundle-canonical.js";
import {
  computeDigest,
  publisherKeyId,
  registryAttestationSigningBytes,
  signBundle,
  verifyPublisherSignature,
  verifyRegistrySignature,
} from "./declarative-bundle-crypto.js";
import { decodeDeclarativePackBundle } from "./declarative-bundle-encoding.js";
import {
  MAX_BUNDLE_ARRAY_ITEMS,
  MAX_BUNDLE_JSON_DEPTH,
  MAX_BUNDLE_JSON_NODES,
  MAX_BUNDLE_OBJECT_FIELDS,
  MAX_BUNDLE_STRING_BYTES,
  MAX_DECLARATIVE_BUNDLE_BYTES,
  bundleIssue,
} from "./declarative-bundle-limits.js";
import {
  isCanonicalTimestamp,
  validateBundleContent,
  validateDeclarativePackBundle,
  validateRegistryAttestationShape,
} from "./declarative-bundle-validation.js";

export { decodeDeclarativePackBundle, validateDeclarativePackBundle };

export {
  MAX_BUNDLE_ARRAY_ITEMS,
  MAX_BUNDLE_JSON_DEPTH,
  MAX_BUNDLE_JSON_NODES,
  MAX_BUNDLE_OBJECT_FIELDS,
  MAX_BUNDLE_STRING_BYTES,
  MAX_DECLARATIVE_BUNDLE_BYTES,
};

export function parseDeclarativePackBundle(
  value: unknown,
): DeclarativePackBundle {
  const issue = validateDeclarativePackBundle(value);
  if (issue !== undefined)
    throw new DeclarativePackBundleValidationError(issue);
  return cloneAndFreeze(value) as DeclarativePackBundle;
}

export function parseDeclarativePackBundleBytes(
  input: string | Uint8Array,
): DeclarativePackBundle {
  return parseDeclarativePackBundle(decodeDeclarativePackBundle(input));
}

export function serializeDeclarativePackBundle(
  bundle: DeclarativePackBundle,
): Uint8Array {
  const checked = parseDeclarativePackBundle(bundle);
  const bytes = encodeUtf8(canonicalizeOrThrow(checked));
  if (bytes.byteLength > MAX_DECLARATIVE_BUNDLE_BYTES) {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("LIMIT_EXCEEDED", "$"),
    );
  }
  return bytes;
}

export function canonicalizeDeclarativePackBundle(
  bundle: DeclarativePackBundle,
): string {
  return decodeUtf8(serializeDeclarativePackBundle(bundle));
}

export async function computeDeclarativePackBundleDigest(
  bundle: DeclarativePackBundleContent | DeclarativePackBundle,
): Promise<string> {
  const content = "publisherSignature" in bundle ? contentOf(bundle) : bundle;
  const issue = validateBundleContent(content);
  if (issue !== undefined)
    throw new DeclarativePackBundleValidationError(issue);
  return computeDigest(content);
}

export { publisherKeyId, registryAttestationSigningBytes };

export async function signDeclarativePackBundle(
  bundle: DeclarativePackBundleContent,
  keys: PublisherSigningKeys,
): Promise<DeclarativePackBundle> {
  const issue = validateBundleContent(bundle);
  if (issue !== undefined)
    throw new DeclarativePackBundleValidationError(issue);
  const digest = await computeDigest(bundle);
  if (bundle.manifest.digest !== digest) {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("DIGEST_MISMATCH", "manifest.digest"),
    );
  }
  try {
    return parseDeclarativePackBundle(await signBundle(bundle, keys));
  } catch (error) {
    if (error instanceof DeclarativePackBundleValidationError) throw error;
    throw new DeclarativePackBundleValidationError(
      bundleIssue("INVALID_VALUE", "publisherSignature"),
    );
  }
}

/** The verifier accepts only serialized bytes so callers cannot bypass strict parsing. */
export async function verifyDeclarativePackBundle(
  input: string | Uint8Array,
  options?: PublisherVerificationOptions,
): Promise<BundleVerificationResult> {
  let bundle: DeclarativePackBundle;
  try {
    bundle = parseDeclarativePackBundleBytes(input);
  } catch (error) {
    if (error instanceof DeclarativePackBundleValidationError) {
      return { ok: false, issue: error.issue };
    }
    return { ok: false, issue: bundleIssue("INVALID_JSON", "$") };
  }
  if (
    options?.runtimeVersion !== undefined &&
    !packSupportsRuntime(bundle.manifest, options.runtimeVersion)
  )
    return {
      ok: false,
      issue: bundleIssue("INCOMPATIBLE", "manifest.compatibility.runtime"),
    };
  if (
    options?.bridgeProtocolVersion !== undefined &&
    !packSupportsBridgeProtocol(bundle.manifest, options.bridgeProtocolVersion)
  )
    return {
      ok: false,
      issue: bundleIssue(
        "INCOMPATIBLE",
        "manifest.compatibility.bridgeProtocol",
      ),
    };
  if (options === undefined)
    return {
      ok: false,
      issue: bundleIssue("INVALID_SIGNATURE", "publisherSignature"),
    };
  const digest = await computeDigest(contentOf(bundle));
  if (digest !== bundle.manifest.digest)
    return {
      ok: false,
      issue: bundleIssue("DIGEST_MISMATCH", "manifest.digest"),
    };
  const issue = await verifyPublisherSignature(bundle, options, digest);
  return issue === undefined ? { ok: true, bundle } : { ok: false, issue };
}

/** Registry verification also accepts only serialized attestation bytes. */
export async function verifyRegistryAttestation(
  input: string | Uint8Array,
  options: RegistryVerificationOptions,
): Promise<boolean> {
  let value: unknown;
  try {
    value = decodeDeclarativePackBundle(input);
  } catch {
    return false;
  }
  const shapeIssue = validateRegistryAttestationShape(value);
  if (shapeIssue !== undefined) return false;
  const attestation = value as RegistryAttestation;
  if (attestation.registryId !== options.expectedRegistryId) return false;
  const now = options.now?.getTime() ?? Date.now();
  if (
    !isCanonicalTimestamp(attestation.issuedAt) ||
    !isCanonicalTimestamp(attestation.expiresAt) ||
    Date.parse(attestation.issuedAt) > now ||
    now >= Date.parse(attestation.expiresAt)
  )
    return false;
  return verifyRegistrySignature(attestation, options);
}

function contentOf(
  bundle: DeclarativePackBundle,
): DeclarativePackBundleContent {
  return {
    bundleVersion: bundle.bundleVersion,
    manifest: bundle.manifest,
    operations: bundle.operations,
    metadata: bundle.metadata,
  };
}
