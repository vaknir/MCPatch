import type {
  ChromePermissionsApi,
  ChromeRegisteredContentScript,
  ChromeScriptingApi,
} from "./enablement-model.js";
import { CONTENT_SCRIPT_FILE } from "./enablement-model.js";
import { isExactHttpsPattern } from "./exact-host-permissions.js";
import type {
  PageAuthority,
  PageSenderIdentity,
} from "./page-context-model.js";

export const CATALOG_REGISTRATION_PREFIX = "mcpatch-catalog-v1-";
const LEGACY_REGISTRATION_PREFIXES = ["mcpatch-v1-", "mcpatch-local-v1-"];
const MAX_CATALOG_ORIGINS = 64;
const MAX_MATCHES_PER_ORIGIN = 64;
const MAX_PERMISSIONS_PER_SITE = 32;
const MAX_REGISTRATION_ID_BYTES = 768;
const MAX_IDENTITY_BYTES = 512;

export interface PackContentSite {
  readonly fingerprint: string;
  readonly matches: readonly string[];
  readonly origin: string;
  readonly permissionPatterns: readonly string[];
}

export interface PackContentSource {
  removeUnusedPermissions(candidates: readonly string[]): Promise<void>;
  replace(sites: readonly PackContentSite[]): Promise<void>;
}

interface SourceState {
  initialized: boolean;
  sites: readonly PackContentSite[];
}

interface OriginPlan {
  readonly fingerprint: string;
  readonly origin: string;
  readonly registration: ChromeRegisteredContentScript;
}

/**
 * Owns the one packaged isolated-world content script allowed per exact origin.
 * Controllers contribute data; this class serializes their changes, revokes
 * live contexts before any mutation, and only re-opens authority after Chrome
 * confirms the complete registration set.
 */
export class PackContentCatalog {
  readonly #permissions: ChromePermissionsApi;
  readonly #scripting: ChromeScriptingApi;
  readonly #sources = new Map<string, SourceState>();
  readonly #readyOrigins = new Set<string>();
  #authorities: readonly PageAuthority[] = [];
  #chain = Promise.resolve();
  #revokeOrigin: (origin: string) => void = () => undefined;

  readonly authority: PageAuthority = Object.freeze({
    authorize: (identity: PageSenderIdentity) => this.#authorize(identity),
  });

  constructor(
    scripting: ChromeScriptingApi,
    permissions: ChromePermissionsApi,
  ) {
    this.#scripting = scripting;
    this.#permissions = permissions;
  }

  createSource(name: string): PackContentSource {
    if (!validSourceName(name) || this.#sources.has(name)) {
      throw new TypeError("pack content source name was rejected");
    }
    const state: SourceState = { initialized: false, sites: Object.freeze([]) };
    this.#sources.set(name, state);
    return Object.freeze({
      replace: (sites: readonly PackContentSite[]) =>
        this.#enqueue(() => this.#replace(state, sites)),
      removeUnusedPermissions: (candidates: readonly string[]) =>
        this.#enqueue(() => this.#removeUnusedPermissions(candidates)),
    });
  }

  setAuthorities(authorities: readonly PageAuthority[]): void {
    this.#authorities = Object.freeze([...authorities]);
  }

  setRevokeOrigin(revokeOrigin: (origin: string) => void): void {
    this.#revokeOrigin = revokeOrigin;
  }

  async idle(): Promise<void> {
    while (true) {
      const pending = this.#chain;
      await pending;
      if (pending === this.#chain) return;
    }
  }

  #authorize(identity: PageSenderIdentity) {
    if (!this.#readyOrigins.has(identity.origin)) return undefined;
    const tools = new Set<string>();
    for (const authority of this.#authorities) {
      const authorization = authority.authorize(identity);
      if (authorization === undefined) continue;
      for (const tool of authorization.packTools) tools.add(tool);
    }
    return tools.size === 0 ? undefined : Object.freeze({ packTools: tools });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#chain.then(operation, operation);
    this.#chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #replace(
    state: SourceState,
    sites: readonly PackContentSite[],
  ): Promise<void> {
    const checked = validateSites(sites);
    const previousPlan = buildPlan(this.#sources.values());
    const previousSites = state.sites;
    const previouslyInitialized = state.initialized;
    state.sites = checked;
    state.initialized = true;
    let nextPlan: ReadonlyMap<string, OriginPlan>;
    try {
      nextPlan = buildPlan(this.#sources.values());
    } catch (error) {
      state.sites = previousSites;
      state.initialized = previouslyInitialized;
      throw error;
    }

    try {
      await this.#reconcile(previousPlan, nextPlan);
    } catch (error) {
      await this.#failClosed(previousPlan, nextPlan);
      throw error;
    }
  }

  async #reconcile(
    previousPlan: ReadonlyMap<string, OriginPlan>,
    nextPlan: ReadonlyMap<string, OriginPlan>,
  ): Promise<void> {
    const current = await this.#scripting.getRegisteredContentScripts();
    assertUniqueIds(current);
    const desired = new Map(
      [...nextPlan.values()].map((plan) => [plan.registration.id, plan]),
    );
    const managed = current.filter((script) => managedRegistration(script.id));
    const remove = managed
      .filter((script) => {
        const expected = desired.get(script.id)?.registration;
        return expected === undefined || !sameRegistration(script, expected);
      })
      .map((script) => script.id)
      .sort();
    const retained = new Set(
      managed
        .filter((script) => !remove.includes(script.id))
        .map((script) => script.id),
    );
    const add = [...desired.values()]
      .map((plan) => plan.registration)
      .filter((script) => !retained.has(script.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    const changedOrigins = changedPlanOrigins(previousPlan, nextPlan);
    if (remove.length > 0 || add.length > 0) {
      for (const origin of nextPlan.keys()) changedOrigins.add(origin);
      for (const origin of previousPlan.keys()) changedOrigins.add(origin);
    }
    this.#revoke(changedOrigins);
    if (remove.length > 0) {
      await this.#scripting.unregisterContentScripts({ ids: remove });
    }
    if (add.length > 0) await this.#scripting.registerContentScripts(add);
    this.#readyOrigins.clear();
    for (const origin of nextPlan.keys()) this.#readyOrigins.add(origin);
  }

  async #failClosed(
    previousPlan: ReadonlyMap<string, OriginPlan>,
    nextPlan: ReadonlyMap<string, OriginPlan>,
  ): Promise<void> {
    const origins = new Set([
      ...this.#readyOrigins,
      ...previousPlan.keys(),
      ...nextPlan.keys(),
    ]);
    this.#revoke(origins);
    this.#readyOrigins.clear();
    try {
      const current = await this.#scripting.getRegisteredContentScripts();
      const ids = current
        .filter((script) => managedRegistration(script.id))
        .map((script) => script.id)
        .sort();
      if (ids.length > 0) {
        await this.#scripting.unregisterContentScripts({ ids });
      }
    } catch {
      // Authority remains closed even if Chrome cannot clean stale scripts yet.
    }
  }

  async #removeUnusedPermissions(candidates: readonly string[]): Promise<void> {
    if ([...this.#sources.values()].some((source) => !source.initialized))
      return;
    const needed = new Set(
      [...this.#sources.values()].flatMap((source) =>
        source.sites.flatMap((site) => site.permissionPatterns),
      ),
    );
    const remove = [...new Set(candidates)]
      .filter(isExactHttpsPattern)
      .filter((pattern) => !needed.has(pattern))
      .sort();
    if (remove.length === 0) return;
    try {
      await this.#permissions.remove({ origins: remove });
    } catch {
      // Content authority is already reconciled; cleanup is best effort.
    }
  }

  #revoke(origins: ReadonlySet<string>): void {
    for (const origin of origins) {
      this.#readyOrigins.delete(origin);
      try {
        this.#revokeOrigin(origin);
      } catch {
        // Authority state cannot depend on observers.
      }
    }
  }
}

export function catalogRegistrationId(origin: string): string {
  const encoded = [...new TextEncoder().encode(origin)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const id = `${CATALOG_REGISTRATION_PREFIX}${encoded}`;
  if (id.length > MAX_REGISTRATION_ID_BYTES) {
    throw new TypeError("pack origin is too long to register safely");
  }
  return id;
}

function validateSites(
  sites: readonly PackContentSite[],
): readonly PackContentSite[] {
  if (!Array.isArray(sites) || sites.length > MAX_CATALOG_ORIGINS * 4) {
    throw new TypeError("pack content sites were rejected");
  }
  const identities = new Set<string>();
  const checked = sites.map((site) => {
    if (!validOrigin(site.origin) || !validFingerprint(site.fingerprint)) {
      throw new TypeError("pack content site identity was rejected");
    }
    const identity = `${site.origin}\u0000${site.fingerprint}`;
    if (identities.has(identity)) {
      throw new TypeError("duplicate pack content site was rejected");
    }
    identities.add(identity);
    if (
      !Array.isArray(site.matches) ||
      site.matches.length === 0 ||
      site.matches.length > MAX_MATCHES_PER_ORIGIN ||
      new Set(site.matches).size !== site.matches.length ||
      site.matches.some((match: string) => !validMatch(site.origin, match))
    ) {
      throw new TypeError("pack content matches were rejected");
    }
    if (
      !Array.isArray(site.permissionPatterns) ||
      site.permissionPatterns.length === 0 ||
      site.permissionPatterns.length > MAX_PERMISSIONS_PER_SITE ||
      new Set(site.permissionPatterns).size !==
        site.permissionPatterns.length ||
      site.permissionPatterns.some(
        (pattern: string) => !isExactHttpsPattern(pattern),
      ) ||
      !site.permissionPatterns.includes(`${site.origin}/*`)
    ) {
      throw new TypeError("pack content permissions were rejected");
    }
    return Object.freeze({
      fingerprint: site.fingerprint,
      matches: Object.freeze([...site.matches].sort()),
      origin: site.origin,
      permissionPatterns: Object.freeze([...site.permissionPatterns].sort()),
    });
  });
  return Object.freeze(checked);
}

function buildPlan(
  sources: Iterable<SourceState>,
): ReadonlyMap<string, OriginPlan> {
  const aggregate = new Map<
    string,
    { fingerprints: string[]; matches: Set<string> }
  >();
  for (const source of sources) {
    for (const site of source.sites) {
      const value = aggregate.get(site.origin) ?? {
        fingerprints: [],
        matches: new Set<string>(),
      };
      value.fingerprints.push(site.fingerprint);
      for (const match of site.matches) value.matches.add(match);
      aggregate.set(site.origin, value);
    }
  }
  if (aggregate.size > MAX_CATALOG_ORIGINS) {
    throw new TypeError("pack content origin limit exceeded");
  }
  const result = new Map<string, OriginPlan>();
  for (const [origin, value] of [...aggregate].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const matches = [...value.matches].sort();
    if (matches.length > MAX_MATCHES_PER_ORIGIN) {
      throw new TypeError("pack content match limit exceeded");
    }
    const id = catalogRegistrationId(origin);
    result.set(
      origin,
      Object.freeze({
        fingerprint: [...value.fingerprints].sort().join("\u0000"),
        origin,
        registration: Object.freeze({
          id,
          matches: Object.freeze(matches),
          js: Object.freeze([CONTENT_SCRIPT_FILE]),
          allFrames: false,
          persistAcrossSessions: true,
          runAt: "document_start",
          world: "ISOLATED",
        }),
      }),
    );
  }
  return result;
}

function changedPlanOrigins(
  previous: ReadonlyMap<string, OriginPlan>,
  next: ReadonlyMap<string, OriginPlan>,
): Set<string> {
  const changed = new Set<string>();
  for (const origin of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(origin);
    const after = next.get(origin);
    if (
      before?.fingerprint !== after?.fingerprint ||
      before === undefined ||
      after === undefined ||
      !sameRegistration(before.registration, after.registration)
    ) {
      changed.add(origin);
    }
  }
  return changed;
}

function validSourceName(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,31}$/u.test(value);
}

function validFingerprint(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= MAX_IDENTITY_BYTES &&
    !value.includes("\u0000")
  );
}

function validOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.origin === value &&
      !value.includes("*")
    );
  } catch {
    return false;
  }
}

function validMatch(origin: string, value: string): boolean {
  if (
    typeof value !== "string" ||
    value.length > 2_048 ||
    !value.startsWith(`${origin}/`) ||
    value.includes("?") ||
    value.includes("#") ||
    hasControlCharacters(value)
  ) {
    return false;
  }
  try {
    return new URL(value.replaceAll("*", "x")).origin === origin;
  } catch {
    return false;
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return true;
  }
  return false;
}

function managedRegistration(id: string): boolean {
  return (
    id.startsWith(CATALOG_REGISTRATION_PREFIX) ||
    LEGACY_REGISTRATION_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
}

function assertUniqueIds(
  scripts: readonly ChromeRegisteredContentScript[],
): void {
  if (new Set(scripts.map((script) => script.id)).size !== scripts.length) {
    throw new Error("duplicate content-script registration");
  }
}

function sameRegistration(
  left: ChromeRegisteredContentScript,
  right: ChromeRegisteredContentScript,
): boolean {
  return (
    left.id === right.id &&
    left.allFrames === right.allFrames &&
    left.persistAcrossSessions === right.persistAcrossSessions &&
    left.runAt === right.runAt &&
    left.world === right.world &&
    JSON.stringify([...left.matches].sort()) ===
      JSON.stringify([...right.matches].sort()) &&
    left.js.length === 1 &&
    left.js[0] === CONTENT_SCRIPT_FILE
  );
}
