import {
  MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
  MAX_DECLARATIVE_BUNDLE_BYTES,
} from "@mcpatch/sdk/runtime";

import {
  COMMUNITY_PACK_STATE_VERSION,
  MAX_COMMUNITY_PACKS,
  type CommunityCandidateRecord,
  type CommunityInstalledRecord,
  type CommunityPackState,
} from "./community-pack-model.js";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const EMPTY_COMMUNITY_PACK_STATE: CommunityPackState = Object.freeze({
  stateVersion: COMMUNITY_PACK_STATE_VERSION,
  highWaterSequence: 0,
  installed: Object.freeze([]),
});

export function createCommunityPackState(value: {
  readonly highWaterSequence: number;
  readonly indexBase64?: string;
  readonly indexVerifiedAt?: string;
  readonly installed: Iterable<CommunityInstalledRecord>;
  readonly candidate?: CommunityCandidateRecord;
}): CommunityPackState {
  const state = {
    stateVersion: COMMUNITY_PACK_STATE_VERSION,
    highWaterSequence: value.highWaterSequence,
    ...(value.indexBase64 === undefined
      ? {}
      : { indexBase64: value.indexBase64 }),
    ...(value.indexVerifiedAt === undefined
      ? {}
      : { indexVerifiedAt: value.indexVerifiedAt }),
    installed: [...value.installed].sort((left, right) =>
      left.installId.localeCompare(right.installId),
    ),
    ...(value.candidate === undefined ? {} : { candidate: value.candidate }),
  };
  const parsed = parseCommunityPackState(state);
  if (parsed === undefined)
    throw new TypeError("community pack state rejected");
  return parsed;
}

export function parseCommunityPackState(
  value: unknown,
): CommunityPackState | undefined {
  if (
    !dataObject(value) ||
    !exactFields(value, [
      "stateVersion",
      "highWaterSequence",
      ...(value.indexBase64 === undefined
        ? []
        : ["indexBase64", "indexVerifiedAt"]),
      "installed",
      ...(value.candidate === undefined ? [] : ["candidate"]),
    ]) ||
    value.stateVersion !== COMMUNITY_PACK_STATE_VERSION ||
    !nonnegativeSafeInteger(value.highWaterSequence) ||
    !Array.isArray(value.installed) ||
    value.installed.length > MAX_COMMUNITY_PACKS
  ) {
    return undefined;
  }
  if (
    (value.indexBase64 === undefined) !==
      (value.indexVerifiedAt === undefined) ||
    (value.indexBase64 !== undefined &&
      (!validBase64(value.indexBase64, MAX_COMMUNITY_REGISTRY_INDEX_BYTES) ||
        !canonicalTimestamp(value.indexVerifiedAt)))
  ) {
    return undefined;
  }
  const installed: CommunityInstalledRecord[] = [];
  const installIds = new Set<string>();
  const identities = new Set<string>();
  for (const record of value.installed) {
    const checked = parseInstalled(record);
    if (checked === undefined) return undefined;
    const identity = `${checked.publisher}/${checked.id}`;
    if (installIds.has(checked.installId) || identities.has(identity)) {
      return undefined;
    }
    installIds.add(checked.installId);
    identities.add(identity);
    installed.push(checked);
  }
  const candidate =
    value.candidate === undefined ? undefined : parseCandidate(value.candidate);
  if (value.candidate !== undefined && candidate === undefined)
    return undefined;
  return Object.freeze({
    stateVersion: COMMUNITY_PACK_STATE_VERSION,
    highWaterSequence: value.highWaterSequence,
    ...(value.indexBase64 === undefined
      ? {}
      : {
          indexBase64: value.indexBase64 as string,
          indexVerifiedAt: value.indexVerifiedAt as string,
        }),
    installed: Object.freeze(installed),
    ...(candidate === undefined ? {} : { candidate }),
  });
}

function parseInstalled(value: unknown): CommunityInstalledRecord | undefined {
  if (
    !dataObject(value) ||
    !exactFields(value, [
      "installId",
      "enabled",
      "publisher",
      "id",
      "version",
      "digest",
      "bundleBase64",
    ]) ||
    typeof value.installId !== "string" ||
    !/^registry\.[a-f0-9]{32}$/u.test(value.installId) ||
    typeof value.enabled !== "boolean" ||
    typeof value.publisher !== "string" ||
    !/^[a-z][a-z0-9]{0,63}$/u.test(value.publisher) ||
    typeof value.id !== "string" ||
    !/^[a-z](?:[a-z0-9-]*[a-z0-9])?$/u.test(value.id) ||
    typeof value.version !== "string" ||
    value.version.length > 64 ||
    !SEMVER.test(value.version) ||
    typeof value.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.digest) ||
    !validBase64(value.bundleBase64, MAX_DECLARATIVE_BUNDLE_BYTES)
  ) {
    return undefined;
  }
  return Object.freeze({
    installId: value.installId,
    enabled: value.enabled,
    publisher: value.publisher,
    id: value.id,
    version: value.version,
    digest: value.digest,
    bundleBase64: value.bundleBase64,
  });
}

function parseCandidate(value: unknown): CommunityCandidateRecord | undefined {
  if (
    !dataObject(value) ||
    !exactFields(value, [
      "candidateToken",
      "installId",
      "expiresAt",
      "indexSequence",
      "publisher",
      "id",
      "version",
      "digest",
      "targetUrl",
      "bundleBase64",
      "freshness",
    ]) ||
    typeof value.candidateToken !== "string" ||
    !/^candidate\.[a-f0-9]{32}$/u.test(value.candidateToken) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt < 0 ||
    !positiveSafeInteger(value.indexSequence) ||
    typeof value.targetUrl !== "string" ||
    value.targetUrl.length > 2_048 ||
    (value.freshness !== "cached" && value.freshness !== "online")
  ) {
    return undefined;
  }
  const installed = parseInstalled({
    installId: value.installId,
    enabled: false,
    publisher: value.publisher,
    id: value.id,
    version: value.version,
    digest: value.digest,
    bundleBase64: value.bundleBase64,
  });
  if (installed === undefined) return undefined;
  return Object.freeze({
    candidateToken: value.candidateToken,
    installId: installed.installId,
    expiresAt: value.expiresAt,
    indexSequence: value.indexSequence,
    publisher: installed.publisher,
    id: installed.id,
    version: installed.version,
    digest: installed.digest,
    targetUrl: value.targetUrl,
    bundleBase64: installed.bundleBase64,
    freshness: value.freshness,
  });
}

export function decodeCommunityBase64(
  value: string,
  maximumBytes: number,
): Uint8Array {
  if (!validBase64(value, maximumBytes)) throw new TypeError("base64 rejected");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeCommunityBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  }
  return btoa(binary);
}

function validBase64(value: unknown, maximumBytes: number): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil(maximumBytes / 3) * 4 + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return false;
  }
  try {
    const binary = atob(value);
    return binary.length <= maximumBytes && btoa(binary) === value;
  } catch {
    return false;
  }
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function dataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
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

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
