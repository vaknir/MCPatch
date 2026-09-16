import type {
  DeclarativePackBundleValidationCode,
  DeclarativePackBundleValidationIssue,
} from "./declarative-bundle-types.js";
import { isRecord, validateJsonBounds } from "./validation/primitives.js";

export const MAX_DECLARATIVE_BUNDLE_BYTES = 1024 * 1024;
export const MAX_BUNDLE_STRING_BYTES = 16 * 1024;
export const MAX_BUNDLE_ARRAY_ITEMS = 512;
export const MAX_BUNDLE_OBJECT_FIELDS = 256;
export const MAX_BUNDLE_JSON_DEPTH = 32;
export const MAX_BUNDLE_JSON_NODES = 8_192;
export const MAX_METADATA_LICENSE_LENGTH = 128;
export const MAX_METADATA_HOMEPAGE_LENGTH = 512;

export type BundleRecord = Record<string, unknown>;

export function bundleIssue(
  code: DeclarativePackBundleValidationCode,
  field: string,
): DeclarativePackBundleValidationIssue {
  return { code, field };
}

export function validateBundleBounds(
  value: unknown,
): DeclarativePackBundleValidationIssue | undefined {
  const commonIssue = validateJsonBounds(value);
  if (commonIssue !== undefined) return commonIssue;
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
      return bundleIssue("LIMIT_EXCEEDED", current.field);
    }
    if (typeof current.value === "string") {
      if (!isWellFormed(current.value) || hasNoncharacter(current.value)) {
        return bundleIssue("INVALID_VALUE", current.field);
      }
      if (
        new TextEncoder().encode(current.value).byteLength >
        MAX_BUNDLE_STRING_BYTES
      ) {
        return bundleIssue("LIMIT_EXCEEDED", current.field);
      }
    } else if (typeof current.value === "number") {
      if (
        !Number.isSafeInteger(current.value) ||
        Object.is(current.value, -0)
      ) {
        return bundleIssue("INVALID_VALUE", current.field);
      }
    } else if (Array.isArray(current.value)) {
      if (current.value.length > MAX_BUNDLE_ARRAY_ITEMS) {
        return bundleIssue("LIMIT_EXCEEDED", current.field);
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
        return bundleIssue("LIMIT_EXCEEDED", current.field);
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

export function isWellFormed(value: string): boolean {
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

export function hasNoncharacter(value: string): boolean {
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

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}
