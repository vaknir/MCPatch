import { DeclarativePackBundleValidationError } from "./declarative-bundle-types.js";
import {
  bundleIssue,
  MAX_DECLARATIVE_BUNDLE_BYTES,
} from "./declarative-bundle-limits.js";
import { encodeUtf8 } from "./declarative-bundle-canonical.js";
import { parseStrictJson } from "./strict-json.js";

const BASE64URL = /^[A-Za-z0-9_-]+$/u;

export function decodeDeclarativePackBundle(
  input: string | Uint8Array,
): unknown {
  const bytes = typeof input === "string" ? encodeUtf8(input) : input;
  if (bytes.byteLength > MAX_DECLARATIVE_BUNDLE_BYTES) {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("LIMIT_EXCEEDED", "$"),
    );
  }
  return parseStrictJson(bytes);
}

export function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeBase64Url(value: unknown, field: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64URL.test(value) ||
    value.length % 4 === 1
  ) {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("INVALID_BASE64", field),
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
    if (encodeBase64Url(bytes) !== value)
      throw new Error("noncanonical base64url");
    return bytes;
  } catch {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("INVALID_BASE64", field),
    );
  }
}
