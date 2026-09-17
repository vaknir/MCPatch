import {
  canonicalizePageLocation,
  packMatchesLocation,
  type PackManifest,
  type PackMatch,
} from "@mcpatch/sdk/runtime";

import {
  configuredKey,
  type ConfiguredPackOrigin,
} from "./configured-origins.js";

import type {
  EnabledPackRecord,
  PackSiteCatalog,
  ReviewedPackSite,
} from "./enablement-model.js";
import { REGISTRATION_PREFIX } from "./enablement-model.js";
import {
  validateCompiledPacks,
  validateRuntimeOptions,
  type CompiledPackRuntimeOptions,
  type CompiledPackSubject,
} from "./compiled-pack-validation.js";

const MAX_DECLARED_ORIGINS = 32;
const MAX_REGISTRATION_ID_BYTES = 768;

export function createReviewedPackCatalog(
  subjects: readonly CompiledPackSubject[],
  options: CompiledPackRuntimeOptions,
  declaredOrigins: readonly string[],
  configured: readonly ConfiguredPackOrigin[] = [],
): PackSiteCatalog {
  const checkedOptions = validateRuntimeOptions(options);
  const origins = validateDeclaredOrigins(declaredOrigins);
  const packs =
    checkedOptions === undefined
      ? undefined
      : validateCompiledPacks(subjects, checkedOptions);
  if (packs === undefined || origins === undefined) {
    throw new TypeError("reviewed pack catalog was rejected");
  }
  const sites: ReviewedPackSite[] = [];
  const keys = new Set<string>();
  for (const pack of packs) {
    const requestOrigins = networkRequestOrigins(pack.manifest);
    for (const origin of requestOrigins) {
      if (!origins.has(origin)) {
        throw new TypeError(
          "reviewed pack network origin is not declared optional authority",
        );
      }
    }
    for (const match of pack.manifest.matches) {
      // A synthetic origin marks a pack whose real deployment is self-hosted, so
      // its site comes from the user's stored configuration instead of a
      // compile-time list. Nothing is emitted until that configuration exists.
      const bindings = match.origin.endsWith(".invalid")
        ? configuredOriginsFor(configured, pack.manifest)
        : [match.origin];
      for (const origin of bindings) {
        if (!match.origin.endsWith(".invalid") && !origins.has(origin)) {
          throw new TypeError(
            "reviewed pack origin is not declared optional authority",
          );
        }
        const key = `${pack.manifest.publisher}/${pack.manifest.id}@${origin}`;
        if (keys.has(key)) throw new TypeError("duplicate reviewed pack site");
        keys.add(key);
        sites.push(
          Object.freeze({
            key,
            manifest: boundManifest(pack.manifest, match, origin),
            origin,
            permissionPattern: `${origin}/*`,
            permissionPatterns: Object.freeze(
              [origin, ...requestOrigins]
                .filter(
                  (value, index, values) => values.indexOf(value) === index,
                )
                .sort()
                .map((value) => `${value}/*`),
            ),
            registrationId: registrationId(origin),
            tools: Object.freeze(
              new Set(pack.manifest.tools.map((tool) => tool.name)),
            ),
          }),
        );
      }
    }
  }
  sites.sort((left, right) => left.key.localeCompare(right.key));
  const frozenSites = Object.freeze(sites);
  return Object.freeze({
    sites: frozenSites,
    match(url: string) {
      const page = canonicalizePageLocation(url);
      if (!page.ok) return Object.freeze([]);
      return Object.freeze(
        frozenSites.filter((site) =>
          packMatchesLocation(site.manifest, page.location),
        ),
      );
    },
    resolve(record: EnabledPackRecord) {
      return frozenSites.find(
        (site) =>
          site.manifest.publisher === record.publisher &&
          site.manifest.id === record.id &&
          site.manifest.version === record.version &&
          site.manifest.digest === record.digest &&
          site.origin === record.origin,
      );
    },
  });
}

function configuredOriginsFor(
  configured: readonly ConfiguredPackOrigin[],
  manifest: PackManifest,
): readonly string[] {
  const seen = new Set<string>();
  return Object.freeze(
    configured
      .filter(
        (site) =>
          site.publisher === manifest.publisher && site.id === manifest.id,
      )
      .filter((site) => {
        const key = configuredKey(site);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((site) => site.origin),
  );
}

/**
 * The declared manifest keeps its reviewed identity and digest; only the origin
 * it is matched and registered against is bound at runtime. The enablement
 * record already stores that origin separately from the digest, so a configured
 * site is identified by both.
 */
function boundManifest(
  manifest: PackManifest,
  match: PackMatch,
  origin: string,
): PackManifest {
  if (match.origin === origin && manifest.matches.length === 1) return manifest;
  return Object.freeze({
    ...manifest,
    matches: Object.freeze([Object.freeze({ origin, paths: match.paths })]),
  });
}

function networkRequestOrigins(manifest: PackManifest): readonly string[] {
  const policy = manifest.networkPolicy.extensionRequests;
  return policy === "none" ? [] : policy.origins;
}

export function recordForSite(site: ReviewedPackSite): EnabledPackRecord {
  return Object.freeze({
    publisher: site.manifest.publisher,
    id: site.manifest.id,
    version: site.manifest.version,
    digest: site.manifest.digest,
    origin: site.origin,
  });
}

function validateDeclaredOrigins(
  values: readonly string[],
): ReadonlySet<string> | undefined {
  if (
    !Array.isArray(values) ||
    values.length > MAX_DECLARED_ORIGINS ||
    new Set(values).size !== values.length
  ) {
    return undefined;
  }
  for (const value of values) {
    try {
      const parsed = new URL(value);
      if (
        parsed.protocol !== "https:" ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.origin !== value ||
        value.includes("*") ||
        value.endsWith(".invalid")
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  return Object.freeze(new Set(values));
}

function registrationId(origin: string): string {
  const encoded = [...new TextEncoder().encode(origin)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const id = `${REGISTRATION_PREFIX}${encoded}`;
  if (id.length > MAX_REGISTRATION_ID_BYTES) {
    throw new TypeError("reviewed pack origin is too long to register safely");
  }
  return id;
}
