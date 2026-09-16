import { MAX_DECLARATIVE_BUNDLE_BYTES } from "@mcpatch/sdk/runtime";

import type {
  LocalPackErrorCode,
  LocalPackRequest,
  LocalPackResult,
} from "./local-pack-model.js";

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function decodeLocalPackBase64(value: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil(MAX_DECLARATIVE_BUNDLE_BYTES / 3) * 4 + 4 ||
    !BASE64.test(value)
  ) {
    throw new TypeError("invalid base64");
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (btoa(binary) !== value) throw new TypeError("noncanonical base64");
  return bytes;
}

export function isLocalPackRequest(value: unknown): value is LocalPackRequest {
  if (!plainDataObject(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "local_pack_content_config":
    case "local_pack_list":
      return exactFields(value, ["type"]);
    case "local_pack_set_developer_mode":
      return (
        exactFields(value, ["type", "enabled"]) &&
        typeof value.enabled === "boolean"
      );
    case "local_pack_preview":
      return (
        exactFields(value, ["type", "base64"]) &&
        typeof value.base64 === "string"
      );
    case "local_pack_install":
      return (
        exactFields(value, ["type", "candidateToken"]) &&
        typeof value.candidateToken === "string"
      );
    case "local_pack_set_enabled":
      return (
        exactFields(value, ["type", "installId", "enabled"]) &&
        typeof value.installId === "string" &&
        typeof value.enabled === "boolean"
      );
    case "local_pack_uninstall":
      return (
        exactFields(value, ["type", "installId"]) &&
        typeof value.installId === "string"
      );
    default:
      return false;
  }
}

export function isLocalPackMessage(value: unknown): boolean {
  return (
    plainDataObject(value) &&
    typeof value.type === "string" &&
    value.type.startsWith("local_pack_")
  );
}

export function localPackSuccess<T>(value: T): LocalPackResult<T> {
  return Object.freeze({ ok: true, value });
}

export function localPackFailure<T = never>(
  code: LocalPackErrorCode,
  field?: string,
): LocalPackResult<T> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, ...(field === undefined ? {} : { field }) }),
  });
}

function plainDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}
