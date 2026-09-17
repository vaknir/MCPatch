import type {
  CommunityRegistryIndex,
  CommunityRegistryPackEntry,
  DeclarativePackBundleContent,
} from "@mcpatch/sdk/runtime";

import { contentScriptMatches } from "./content-script-matches.js";
import type {
  CommunityCandidateRecord,
  CommunityInstalledRecord,
  CommunityPackReview,
  EffectiveCommunityPack,
} from "./community-pack-model.js";
import type { PackContentSite } from "./pack-content-catalog.js";

interface VerifiedCandidate {
  readonly record: CommunityCandidateRecord;
  readonly entry: CommunityRegistryPackEntry;
  readonly bundle: DeclarativePackBundleContent;
}

export function communityContentSites(
  packs: readonly EffectiveCommunityPack[],
): readonly PackContentSite[] {
  const result: PackContentSite[] = [];
  for (const { record, entry, bundle } of packs) {
    const matches = new Map<string, Set<string>>();
    for (const match of bundle.manifest.matches) {
      const patterns = matches.get(match.origin) ?? new Set<string>();
      for (const pattern of contentScriptMatches(match)) patterns.add(pattern);
      matches.set(match.origin, patterns);
    }
    for (const [origin, patterns] of matches) {
      result.push({
        fingerprint: JSON.stringify([
          "community",
          record.installId,
          entry.trust,
          entry.publisher,
          entry.id,
          entry.version,
          entry.bundleDigest,
          entry.attestation.publicationSequence,
        ]),
        matches: [...patterns].sort(),
        origin,
        permissionPatterns: entry.origins.map((value) => `${value}/*`).sort(),
      });
    }
  }
  return Object.freeze(result);
}

export function communityPackReview(
  candidate: VerifiedCandidate,
  index: CommunityRegistryIndex,
): CommunityPackReview {
  const manifest = candidate.bundle.manifest;
  return Object.freeze({
    candidateToken: candidate.record.candidateToken,
    publisher: manifest.publisher,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    digest: manifest.digest,
    trust: candidate.entry.trust,
    origins: candidate.entry.origins,
    paths: Object.freeze(
      manifest.matches.map((match) =>
        Object.freeze({
          origin: match.origin,
          rules: Object.freeze(
            match.paths.map((rule) => `${rule.kind}:${rule.path}`),
          ),
        }),
      ),
    ),
    tools: Object.freeze(
      manifest.tools.map((tool) =>
        Object.freeze({
          name: tool.name,
          ...(tool.title === undefined ? {} : { title: tool.title }),
          description: tool.description,
          risk: tool.risk,
          permissions: tool.permissions,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
        }),
      ),
    ),
    compatibility: manifest.compatibility,
    networkPolicy: manifest.networkPolicy,
    verification: candidate.entry.verification,
    publisherPublicKey: candidate.entry.publisherKey,
    registryKeyId: candidate.entry.attestation.keyId,
    registrySequence: index.publicationSequence,
    issuedAt: index.issuedAt,
    expiresAt: index.expiresAt,
    freshness: candidate.record.freshness,
  });
}

export function communityEntryFor(
  index: CommunityRegistryIndex,
  record: Pick<
    CommunityInstalledRecord,
    "publisher" | "id" | "version" | "digest"
  >,
): CommunityRegistryPackEntry | undefined {
  return index.packs.find(
    (entry) =>
      entry.publisher === record.publisher &&
      entry.id === record.id &&
      entry.version === record.version &&
      entry.bundleDigest === record.digest,
  );
}

export function communityIdentity(value: {
  readonly publisher: string;
  readonly id: string;
}): string {
  return `${value.publisher}/${value.id}`;
}
