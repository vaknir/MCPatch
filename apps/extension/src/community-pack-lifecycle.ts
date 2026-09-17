import type {
  CommunityRegistryIndex,
  CommunityRegistryPackEntry,
  DeclarativePackBundleContent,
} from "@mcpatch/sdk/runtime";

import type {
  CommunityArtifactRecord,
  CommunityCandidateKind,
  CommunityCandidateRecord,
  CommunityInstalledRecord,
} from "./community-pack-model.js";
import {
  communityEntryFor,
  communityIdentity,
} from "./community-pack-projection.js";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface ParsedVersion {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

export function compareCommunityVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const difference =
      (leftVersion.core[index] as number) -
      (rightVersion.core[index] as number);
    if (difference !== 0) return Math.sign(difference);
  }
  if (
    leftVersion.prerelease.length === 0 ||
    rightVersion.prerelease.length === 0
  ) {
    return (
      Number(leftVersion.prerelease.length === 0) -
      Number(rightVersion.prerelease.length === 0)
    );
  }
  const length = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/u.test(leftIdentifier);
    const rightNumeric = /^\d+$/u.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifier(leftIdentifier, rightIdentifier);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function latestCommunityEntry(
  entries: readonly CommunityRegistryPackEntry[],
): CommunityRegistryPackEntry | undefined {
  return entries.reduce<CommunityRegistryPackEntry | undefined>(
    (latest, entry) =>
      latest === undefined ||
      compareCommunityVersions(entry.version, latest.version) > 0
        ? entry
        : latest,
    undefined,
  );
}

export type CommunityCandidateSelection =
  | Readonly<{
      readonly status: "candidate";
      readonly entry: CommunityRegistryPackEntry;
      readonly existing?: CommunityInstalledRecord;
      readonly kind: CommunityCandidateKind;
    }>
  | Readonly<{
      readonly status: "enabled" | "unavailable" | "unsupported";
    }>;

export function selectCommunityCandidate(
  index: CommunityRegistryIndex,
  installed: readonly CommunityInstalledRecord[],
  origin: string,
): CommunityCandidateSelection {
  const matching = index.packs.filter(
    (entry) =>
      entry.revocation.status === "ACTIVE" && entry.origins.includes(origin),
  );
  const installedAtOrigin = installed.filter((record) =>
    record.origins.includes(origin),
  );
  if (installedAtOrigin.length > 1) return { status: "unavailable" };
  const existing = installedAtOrigin[0];
  if (existing === undefined) {
    const identities = new Map<string, CommunityRegistryPackEntry[]>();
    for (const candidate of matching) {
      const identity = communityIdentity(candidate);
      const versions = identities.get(identity) ?? [];
      versions.push(candidate);
      identities.set(identity, versions);
    }
    if (identities.size !== 1) {
      return {
        status: matching.length === 0 ? "unsupported" : "unavailable",
      };
    }
    const entry = latestCommunityEntry([...identities.values()][0] ?? []);
    return entry === undefined
      ? { status: "unavailable" }
      : { status: "candidate", kind: "install", entry };
  }
  const current = communityEntryFor(index, existing);
  if (current === undefined) return { status: "unavailable" };
  const newer = latestCommunityEntry(
    matching.filter(
      (candidate) =>
        communityIdentity(candidate) === communityIdentity(existing) &&
        compareCommunityVersions(candidate.version, existing.version) > 0,
    ),
  );
  if (newer !== undefined) {
    return { status: "candidate", kind: "update", entry: newer, existing };
  }
  if (
    current.revocation.status === "ACTIVE" &&
    existing.previous !== undefined
  ) {
    const rollback = communityEntryFor(index, existing.previous);
    if (
      rollback?.revocation.status === "ACTIVE" &&
      compareCommunityVersions(rollback.version, existing.version) < 0
    ) {
      return {
        status: "candidate",
        kind: "rollback",
        entry: rollback,
        existing,
      };
    }
  }
  return {
    status: current.revocation.status === "ACTIVE" ? "enabled" : "unavailable",
  };
}

export function artifactRecord(
  entry: CommunityRegistryPackEntry,
  bundle: DeclarativePackBundleContent,
  bundleBase64: string,
): CommunityArtifactRecord {
  return Object.freeze({
    publisher: entry.publisher,
    id: entry.id,
    version: entry.version,
    digest: entry.bundleDigest,
    publisherKey: entry.publisherKey,
    trust: entry.trust,
    operationsVersion: bundle.operations.operationsVersion,
    origins: Object.freeze([...entry.origins]),
    bundleBase64,
  });
}

export function artifactMatches(
  record: CommunityArtifactRecord,
  entry: CommunityRegistryPackEntry,
  bundle: DeclarativePackBundleContent,
): boolean {
  return (
    record.publisher === entry.publisher &&
    record.id === entry.id &&
    record.version === entry.version &&
    record.digest === entry.bundleDigest &&
    record.publisherKey === entry.publisherKey &&
    record.trust === entry.trust &&
    record.operationsVersion === bundle.operations.operationsVersion &&
    equalStrings(record.origins, entry.origins) &&
    bundle.manifest.publisher === record.publisher &&
    bundle.manifest.id === record.id &&
    bundle.manifest.version === record.version &&
    bundle.manifest.digest === record.digest
  );
}

export function withoutInstallState(
  record: CommunityInstalledRecord,
): CommunityArtifactRecord {
  return Object.freeze({
    publisher: record.publisher,
    id: record.id,
    version: record.version,
    digest: record.digest,
    publisherKey: record.publisherKey,
    trust: record.trust,
    operationsVersion: record.operationsVersion,
    origins: record.origins,
    bundleBase64: record.bundleBase64,
  });
}

export function validCommunityActivation(
  candidate: CommunityCandidateRecord,
  current: CommunityInstalledRecord | undefined,
): boolean {
  switch (candidate.kind) {
    case "install":
      return current === undefined;
    case "update":
      return (
        current !== undefined &&
        compareCommunityVersions(candidate.version, current.version) > 0
      );
    case "rollback":
      return (
        current?.previous !== undefined &&
        candidate.publisher === current.previous.publisher &&
        candidate.id === current.previous.id &&
        candidate.version === current.previous.version &&
        candidate.digest === current.previous.digest &&
        compareCommunityVersions(candidate.version, current.version) < 0
      );
  }
}

function parseVersion(value: string): ParsedVersion {
  const match = SEMVER.exec(value);
  if (match === null) throw new TypeError("community pack version rejected");
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left < right ? -1 : 1;
}

function equalStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
