import {
  MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
  MAX_DECLARATIVE_BUNDLE_BYTES,
  canonicalizePageLocation,
  packMatchesLocation,
  type CommunityRegistryIndex,
  type CommunityRegistryPackEntry,
  type DeclarativePackBundleContent,
} from "@mcpatch/sdk/runtime";

import type { CommunityRegistryClient } from "./community-registry-client.js";
import { artifactMatches } from "./community-pack-lifecycle.js";
import type {
  CommunityCandidateRecord,
  CommunityPackState,
  EffectiveCommunityPack,
} from "./community-pack-model.js";
import {
  communityEntryFor,
  communityIdentity,
} from "./community-pack-projection.js";
import { decodeCommunityBase64 } from "./community-pack-storage.js";

export interface VerifiedCommunityPackSnapshot {
  readonly index?: CommunityRegistryIndex;
  readonly installed: readonly EffectiveCommunityPack[];
  readonly candidate?: Readonly<{
    readonly record: CommunityCandidateRecord;
    readonly entry: CommunityRegistryPackEntry;
    readonly bundle: DeclarativePackBundleContent;
  }>;
}

export async function verifyCommunityPackState(
  state: CommunityPackState,
  now: Date,
  client: CommunityRegistryClient,
  reviewedIdentities: ReadonlySet<string>,
): Promise<VerifiedCommunityPackSnapshot> {
  if (state.indexBase64 === undefined) {
    if (
      state.highWaterSequence !== 0 ||
      state.installed.length !== 0 ||
      state.candidate !== undefined
    ) {
      throw new Error("community state has no index");
    }
    return Object.freeze({ installed: Object.freeze([]) });
  }
  const index = await client.indexFromCache(
    decodeCommunityBase64(
      state.indexBase64,
      MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
    ),
    state.highWaterSequence,
    now,
  );
  if (index.publicationSequence !== state.highWaterSequence) {
    throw new Error("community state sequence mismatch");
  }
  const installed: EffectiveCommunityPack[] = [];
  for (const record of state.installed) {
    if (reviewedIdentities.has(communityIdentity(record))) {
      throw new Error("reviewed identity collision");
    }
    const entry = communityEntryFor(index, record);
    if (entry === undefined || entry.revocation.status !== "ACTIVE") continue;
    const verified = await client.verifyPackBytes(
      index,
      entry,
      decodeCommunityBase64(record.bundleBase64, MAX_DECLARATIVE_BUNDLE_BYTES),
      now,
    );
    if (!artifactMatches(record, entry, verified.content)) continue;
    installed.push({ record, entry, bundle: verified.content });
  }
  let candidate: VerifiedCommunityPackSnapshot["candidate"];
  if (
    state.candidate !== undefined &&
    state.candidate.expiresAt > now.getTime() &&
    state.candidate.indexSequence === index.publicationSequence
  ) {
    const entry = communityEntryFor(index, state.candidate);
    if (entry !== undefined && entry.revocation.status === "ACTIVE") {
      const verified = await client.verifyPackBytes(
        index,
        entry,
        decodeCommunityBase64(
          state.candidate.bundleBase64,
          MAX_DECLARATIVE_BUNDLE_BYTES,
        ),
        now,
      );
      const page = canonicalizePageLocation(state.candidate.targetUrl);
      if (
        artifactMatches(state.candidate, entry, verified.content) &&
        page.ok &&
        packMatchesLocation(verified.content.manifest, page.location)
      ) {
        candidate = Object.freeze({
          record: state.candidate,
          entry,
          bundle: verified.content,
        });
      }
    }
  }
  return Object.freeze({
    index,
    installed: Object.freeze(installed),
    ...(candidate === undefined ? {} : { candidate }),
  });
}
