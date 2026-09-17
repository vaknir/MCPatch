export const ORIGIN_CONFIG_STORAGE_KEY = "mcpatch.origins.v1";
export const ORIGIN_CONFIG_STATE_VERSION = 1 as const;

const MAX_CONFIGURED_SITES = 8;
const IDENTIFIER = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const PUBLISHER = /^[a-z][a-z0-9]{1,62}[a-z0-9]$/;

/** One self-hosted deployment origin the user configured for one pack. */
export interface ConfiguredPackOrigin {
  readonly publisher: string;
  readonly id: string;
  readonly origin: string;
}

export interface OriginConfigState {
  readonly stateVersion: typeof ORIGIN_CONFIG_STATE_VERSION;
  readonly sites: readonly ConfiguredPackOrigin[];
}

export const EMPTY_ORIGIN_CONFIG: OriginConfigState = Object.freeze({
  stateVersion: ORIGIN_CONFIG_STATE_VERSION,
  sites: Object.freeze([]),
});

/**
 * Configuration is a request, never authority. A stored origin only says which
 * site the user wants a configurable pack offered on; the browser grant and the
 * registered script still have to agree before anything is enabled.
 */
export function parseOriginConfigState(
  value: unknown,
): OriginConfigState | undefined {
  const state = exactObject(value, ["stateVersion", "sites"]);
  if (
    state === undefined ||
    state.stateVersion !== ORIGIN_CONFIG_STATE_VERSION ||
    !Array.isArray(state.sites) ||
    state.sites.length > MAX_CONFIGURED_SITES
  ) {
    return undefined;
  }
  const sites: ConfiguredPackOrigin[] = [];
  const keys = new Set<string>();
  for (const candidate of state.sites) {
    const site = parseSite(candidate);
    if (site === undefined) return undefined;
    const key = configuredKey(site);
    if (keys.has(key)) return undefined;
    keys.add(key);
    sites.push(site);
  }
  sites.sort((left, right) =>
    configuredKey(left).localeCompare(configuredKey(right)),
  );
  return Object.freeze({
    stateVersion: ORIGIN_CONFIG_STATE_VERSION,
    sites: Object.freeze(sites),
  });
}

export function configuredKey(site: ConfiguredPackOrigin): string {
  return `${site.publisher}/${site.id}@${site.origin}`;
}

function parseSite(value: unknown): ConfiguredPackOrigin | undefined {
  const site = exactObject(value, ["publisher", "id", "origin"]);
  if (
    site === undefined ||
    typeof site.publisher !== "string" ||
    !PUBLISHER.test(site.publisher) ||
    typeof site.id !== "string" ||
    !IDENTIFIER.test(site.id) ||
    typeof site.origin !== "string" ||
    !canonicalOrigin(site.origin)
  ) {
    return undefined;
  }
  return Object.freeze({
    publisher: site.publisher,
    id: site.id,
    origin: site.origin,
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
