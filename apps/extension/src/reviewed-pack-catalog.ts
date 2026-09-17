import { contentScriptMatches } from "./content-script-matches.js";
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
import {
  validateCompiledPacks,
  validateRuntimeOptions,
  type CompiledPackRuntimeOptions,
  type CompiledPackSubject,
} from "./compiled-pack-validation.js";

const MAX_DECLARED_ORIGINS = 32;

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
      // A synthetic origin marks a pack whose real deployment is self-hosted,
      // so its sites come from the user's stored configuration rather than a
      // compile-time list. Nothing is emitted until that configuration exists.
      const configurable = match.origin.endsWith(".invalid");
      const bindings = configurable
        ? configuredOriginsFor(configured, pack.manifest)
        : [match.origin];
      for (const origin of bindings) {
        if (!configurable && !origins.has(origin)) {
          throw new TypeError(
            "reviewed pack origin is not declared optional authority",
          );
        }
        const bound = boundMatch(match, origin);
        const key = `${pack.manifest.publisher}/${pack.manifest.id}@${origin}`;
        if (keys.has(key)) throw new TypeError("duplicate reviewed pack site");
        keys.add(key);
        sites.push(
          Object.freeze({
            key,
            manifest: boundManifest(pack.manifest, bound, configurable),
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
            scriptMatches: contentScriptMatches(bound),
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

function boundMatch(match: PackMatch, origin: string): PackMatch {
  return match.origin === origin
    ? match
    : Object.freeze({ origin, paths: match.paths });
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
  configurable: boolean,
): PackManifest {
  if (!configurable) return manifest;
  return Object.freeze({ ...manifest, matches: Object.freeze([match]) });
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
