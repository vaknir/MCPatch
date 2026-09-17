import type {
  CommunityPackErrorCode,
  CommunityPackRequest,
  CommunityPackResult,
} from "./community-pack-model.js";

export function isCommunityPackRequest(
  value: unknown,
): value is CommunityPackRequest {
  if (!dataObject(value) || typeof value.type !== "string") return false;
  if (value.type === "community_pack_content_config") {
    return exactFields(value, ["type"]);
  }
  if (
    value.type === "community_pack_review_get" ||
    value.type === "community_pack_install"
  ) {
    return (
      exactFields(value, ["type", "candidateToken"]) &&
      typeof value.candidateToken === "string" &&
      /^candidate\.[a-f0-9]{32}$/u.test(value.candidateToken)
    );
  }
  return false;
}

export function isCommunityPackMessage(value: unknown): boolean {
  return (
    dataObject(value) &&
    typeof value.type === "string" &&
    value.type.startsWith("community_pack_")
  );
}

export function communityPackSuccess<T>(value: T): CommunityPackResult<T> {
  return Object.freeze({ ok: true, value });
}

export function communityPackFailure<T = never>(
  code: CommunityPackErrorCode,
): CommunityPackResult<T> {
  return Object.freeze({ ok: false, error: Object.freeze({ code }) });
}

function dataObject(value: unknown): value is Record<string, unknown> {
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
