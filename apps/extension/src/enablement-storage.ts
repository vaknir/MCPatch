import {
  ENABLEMENT_STATE_VERSION,
  type EnabledPackRecord,
  type EnablementState,
} from "./enablement-model.js";

const MAX_ENABLED_PACKS = 32;
const IDENTIFIER = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const PUBLISHER = /^[a-z][a-z0-9]{1,62}[a-z0-9]$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export const EMPTY_ENABLEMENT_STATE: EnablementState = Object.freeze({
  stateVersion: ENABLEMENT_STATE_VERSION,
  enabled: Object.freeze([]),
});

export function parseEnablementState(
  value: unknown,
): EnablementState | undefined {
  const state = exactObject(value, ["stateVersion", "enabled"]);
  if (
    state === undefined ||
    state.stateVersion !== ENABLEMENT_STATE_VERSION ||
    !Array.isArray(state.enabled) ||
    state.enabled.length > MAX_ENABLED_PACKS
  ) {
    return undefined;
  }
  const records: EnabledPackRecord[] = [];
  const keys = new Set<string>();
  for (const value of state.enabled) {
    const record = parseRecord(value);
    if (record === undefined) return undefined;
    const key = recordKey(record);
    if (keys.has(key)) return undefined;
    keys.add(key);
    records.push(record);
  }
  records.sort((left, right) =>
    recordKey(left).localeCompare(recordKey(right)),
  );
  return Object.freeze({
    stateVersion: ENABLEMENT_STATE_VERSION,
    enabled: Object.freeze(records),
  });
}

export function createEnablementState(
  records: Iterable<EnabledPackRecord>,
): EnablementState {
  const candidate = {
    stateVersion: ENABLEMENT_STATE_VERSION,
    enabled: [...records],
  };
  const parsed = parseEnablementState(candidate);
  if (parsed === undefined)
    throw new TypeError("enablement state was rejected");
  return parsed;
}

export function recordKey(record: EnabledPackRecord): string {
  return `${record.publisher}/${record.id}@${record.origin}`;
}

export function sameEnablementState(
  left: EnablementState,
  right: EnablementState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseRecord(value: unknown): EnabledPackRecord | undefined {
  const record = exactObject(value, [
    "publisher",
    "id",
    "version",
    "digest",
    "origin",
  ]);
  if (
    record === undefined ||
    typeof record.publisher !== "string" ||
    !PUBLISHER.test(record.publisher) ||
    typeof record.id !== "string" ||
    !IDENTIFIER.test(record.id) ||
    typeof record.version !== "string" ||
    !SEMVER.test(record.version) ||
    typeof record.digest !== "string" ||
    !DIGEST.test(record.digest) ||
    typeof record.origin !== "string" ||
    !canonicalOrigin(record.origin)
  ) {
    return undefined;
  }
  return Object.freeze({
    publisher: record.publisher,
    id: record.id,
    version: record.version,
    digest: record.digest,
    origin: record.origin,
  });
}

function exactObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    return undefined;
  }
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    result[field] = descriptor.value;
  }
  return result;
}

function canonicalOrigin(value: string): boolean {
  if (value.length > 2_048 || value.includes("*")) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.origin === value &&
      !value.endsWith(".invalid")
    );
  } catch {
    return false;
  }
}
