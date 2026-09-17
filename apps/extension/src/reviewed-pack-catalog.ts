import { contentScriptMatches } from "./content-script-matches.js";
import {
  canonicalizePageLocation,
  packMatchesLocation,
  type PackManifest,
} from "@mcpatch/sdk/runtime";

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
      const origin = match.origin;
      if (origin.endsWith(".invalid")) continue;
      if (!origins.has(origin)) {
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
          manifest: pack.manifest,
          origin,
          permissionPattern: `${origin}/*`,
          permissionPatterns: Object.freeze(
            [origin, ...requestOrigins]
              .filter((value, index, values) => values.indexOf(value) === index)
              .sort()
              .map((value) => `${value}/*`),
          ),
          scriptMatches: contentScriptMatches(match),
          tools: Object.freeze(
            new Set(pack.manifest.tools.map((tool) => tool.name)),
          ),
        }),
      );
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
