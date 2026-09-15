import type {
  CapabilityCollision,
  CapabilityContextBinding,
  NativeCapabilityCandidate,
  PackIdentity,
  ResolvedCapability,
} from "./resolution-types.js";
import type { PackToolManifest } from "./types.js";

export interface PackEntry<TPack> {
  readonly identity: PackIdentity;
  readonly tool: PackToolManifest;
  readonly value: TPack;
}

export interface ResolutionBucket<TNative, TPack> {
  readonly native: NativeCapabilityCandidate<TNative>[];
  readonly packs: PackEntry<TPack>[];
}

export function resolutionBucket<TNative, TPack>(
  buckets: Map<string, ResolutionBucket<TNative, TPack>>,
  name: string,
): ResolutionBucket<TNative, TPack> {
  const current = buckets.get(name);
  if (current !== undefined) return current;
  const created = { native: [], packs: [] };
  buckets.set(name, created);
  return created;
}

export function selectCapabilities<TNative, TPack>(
  buckets: Map<string, ResolutionBucket<TNative, TPack>>,
  binding: CapabilityContextBinding,
): {
  capabilities: ResolvedCapability<TNative, TPack>[];
  collisions: CapabilityCollision[];
} {
  const capabilities: ResolvedCapability<TNative, TPack>[] = [];
  const collisions: CapabilityCollision[] = [];
  for (const name of [...buckets.keys()].sort()) {
    const candidates = buckets.get(name);
    if (candidates === undefined) continue;
    candidates.packs.sort(comparePackEntries);
    selectBucket(name, candidates, binding, capabilities, collisions);
  }
  return { capabilities, collisions };
}

function selectBucket<TNative, TPack>(
  name: string,
  candidates: ResolutionBucket<TNative, TPack>,
  binding: CapabilityContextBinding,
  capabilities: ResolvedCapability<TNative, TPack>[],
  collisions: CapabilityCollision[],
): void {
  const nativeCount = candidates.native.length;
  const identities = Object.freeze(
    candidates.packs.map(({ identity }) => identity),
  );
  if (nativeCount > 1) {
    collisions.push(
      collision(name, nativeCount, identities, "hidden", "ambiguous_native"),
    );
    return;
  }
  const native = candidates.native[0];
  if (native !== undefined) {
    capabilities.push(
      Object.freeze({
        binding,
        name,
        source: "native_webmcp",
        value: native.value,
      }),
    );
    if (candidates.packs.length > 0) {
      collisions.push(
        collision(name, 1, identities, "native", "native_precedence"),
      );
    }
    return;
  }
  if (candidates.packs.length > 1) {
    collisions.push(collision(name, 0, identities, "hidden", "ambiguous_pack"));
    return;
  }
  const selected = candidates.packs[0];
  if (selected === undefined) return;
  capabilities.push(
    Object.freeze({
      binding,
      name,
      source: "pack",
      pack: selected.identity,
      tool: selected.tool,
      value: selected.value,
    }),
  );
}

function collision(
  name: string,
  nativeCount: number,
  packs: readonly PackIdentity[],
  outcome: CapabilityCollision["outcome"],
  reason: CapabilityCollision["reason"],
): CapabilityCollision {
  return Object.freeze({ name, nativeCount, outcome, packs, reason });
}

function comparePackEntries<TPack>(
  left: PackEntry<TPack>,
  right: PackEntry<TPack>,
): number {
  const leftKey = identityKey(left.identity);
  const rightKey = identityKey(right.identity);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function identityKey(identity: PackIdentity): string {
  return `${identity.publisher}/${identity.id}@${identity.version}#${identity.digest}`;
}
