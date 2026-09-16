import canonicalize from "canonicalize";

import type {
  DeclarativePackBundle,
  DeclarativePackBundleContent,
} from "./declarative-bundle-types.js";
import {
  bundleIssue,
  hasNoncharacter,
  isWellFormed,
  type BundleRecord,
} from "./declarative-bundle-limits.js";
import { DeclarativePackBundleValidationError } from "./declarative-bundle-types.js";

export const DOMAIN_DIGEST =
  "MCPatch declarative pack bundle digest\0bundle=1\0";
export const DOMAIN_SIGNATURE =
  "MCPatch declarative pack bundle signature\0bundle=1\0";
export const DOMAIN_REGISTRY =
  "MCPatch declarative pack registry attestation\0attestation=1\0";

const jcs = canonicalize as unknown as (value: unknown) => string | undefined;

export function canonicalizeOrThrow(value: unknown): string {
  try {
    const result = jcs(value);
    if (result === undefined) throw new Error("not JSON");
    return result;
  } catch {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("INVALID_VALUE", "$"),
    );
  }
}

export function encodeUtf8(value: string): Uint8Array {
  if (!isWellFormed(value) || hasNoncharacter(value)) {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("INVALID_VALUE", "$"),
    );
  }
  return new TextEncoder().encode(value);
}

export function decodeUtf8(value: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("INVALID_JSON", "$"),
    );
  }
}

export function digestPayload(
  bundle: DeclarativePackBundleContent,
): BundleRecord {
  const manifest = { ...bundle.manifest } as BundleRecord;
  Reflect.deleteProperty(manifest, "digest");
  return {
    bundleVersion: bundle.bundleVersion,
    manifest,
    metadata: bundle.metadata,
    operations: bundle.operations,
  };
}

export function signingBytes(
  bundle: DeclarativePackBundleContent | DeclarativePackBundle,
  digest: string,
): Uint8Array {
  const content =
    "publisherSignature" in bundle
      ? {
          bundleVersion: bundle.bundleVersion,
          manifest: bundle.manifest,
          operations: bundle.operations,
          metadata: bundle.metadata,
        }
      : bundle;
  return concat(
    encodeUtf8(DOMAIN_SIGNATURE),
    encodeUtf8(
      canonicalizeOrThrow({ digest, payload: digestPayload(content) }),
    ),
  );
}

export function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

export function toCryptoBuffer(value: Uint8Array): BufferSource {
  return value as unknown as BufferSource;
}

export function webCrypto(): Crypto {
  if (globalThis.crypto === undefined)
    throw new Error("Web Crypto is unavailable");
  return globalThis.crypto;
}

export async function sha256(value: Uint8Array): Promise<ArrayBuffer> {
  return webCrypto().subtle.digest("SHA-256", toCryptoBuffer(value));
}

export function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
