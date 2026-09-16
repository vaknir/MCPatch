import {
  parseDeclarativePackBundleContent,
  type DeclarativePackBundleContent,
} from "@mcpatch/sdk/runtime";

import {
  LOCAL_PACK_STATE_VERSION,
  LOCAL_PACK_TRUST,
  MAX_LOCAL_PACKS,
  type LocalPackRecord,
  type LocalPackState,
} from "./local-pack-model.js";

const INSTALL_ID = /^local\.[a-f0-9]{32}$/u;
const MAX_LOCAL_STATE_BYTES = 4 * 1024 * 1024;

export const EMPTY_LOCAL_PACK_STATE: LocalPackState = Object.freeze({
  stateVersion: LOCAL_PACK_STATE_VERSION,
  developerMode: false,
  packs: Object.freeze([]),
});

export function parseLocalPackState(
  value: unknown,
): LocalPackState | undefined {
  if (!exactObject(value, ["stateVersion", "developerMode", "packs"])) {
    return undefined;
  }
  if (
    value.stateVersion !== LOCAL_PACK_STATE_VERSION ||
    typeof value.developerMode !== "boolean" ||
    !Array.isArray(value.packs) ||
    value.packs.length > MAX_LOCAL_PACKS
  ) {
    return undefined;
  }
  const ids = new Set<string>();
  const identities = new Set<string>();
  const packs: LocalPackRecord[] = [];
  for (const candidate of value.packs) {
    const record = parseRecord(candidate);
    if (record === undefined) return undefined;
    const identity = `${record.bundle.manifest.publisher}/${record.bundle.manifest.id}`;
    if (ids.has(record.installId) || identities.has(identity)) return undefined;
    ids.add(record.installId);
    identities.add(identity);
    packs.push(record);
  }
  const state = Object.freeze({
    stateVersion: LOCAL_PACK_STATE_VERSION,
    developerMode: value.developerMode,
    packs: Object.freeze(
      packs.sort((left, right) =>
        left.installId.localeCompare(right.installId),
      ),
    ),
  });
  return serializedSize(state) <= MAX_LOCAL_STATE_BYTES ? state : undefined;
}

export function createLocalPackState(
  developerMode: boolean,
  records: Iterable<LocalPackRecord>,
): LocalPackState {
  const candidate = {
    stateVersion: LOCAL_PACK_STATE_VERSION,
    developerMode,
    packs: [...records],
  };
  const parsed = parseLocalPackState(candidate);
  if (parsed === undefined) throw new TypeError("local pack state rejected");
  return parsed;
}

export function localPackRecord(
  installId: string,
  enabled: boolean,
  bundle: DeclarativePackBundleContent,
): LocalPackRecord {
  const parsed = parseRecord({
    installId,
    trust: LOCAL_PACK_TRUST,
    enabled,
    bundle,
  });
  if (parsed === undefined) throw new TypeError("local pack record rejected");
  return parsed;
}

function parseRecord(value: unknown): LocalPackRecord | undefined {
  if (!exactObject(value, ["installId", "trust", "enabled", "bundle"])) {
    return undefined;
  }
  if (
    typeof value.installId !== "string" ||
    !INSTALL_ID.test(value.installId) ||
    value.trust !== LOCAL_PACK_TRUST ||
    typeof value.enabled !== "boolean"
  ) {
    return undefined;
  }
  try {
    return Object.freeze({
      installId: value.installId,
      trust: LOCAL_PACK_TRUST,
      enabled: value.enabled,
      bundle: parseDeclarativePackBundleContent(value.bundle),
    });
  } catch {
    return undefined;
  }
}

function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function exactObject(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    return false;
  }
  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor !== undefined && "value" in descriptor;
  });
}
