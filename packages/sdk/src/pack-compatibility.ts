import type { PackManifest } from "./types.js";
import { compareStableVersions } from "./validation/primitives.js";

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Checks a validated pack's closed-open runtime compatibility interval. */
export function packSupportsRuntime(
  manifest: PackManifest,
  runtimeVersion: string,
): boolean {
  if (!STABLE_SEMVER.test(runtimeVersion)) return false;
  return (
    compareStableVersions(
      runtimeVersion,
      manifest.compatibility.runtime.minimum,
    ) >= 0 &&
    compareStableVersions(
      runtimeVersion,
      manifest.compatibility.runtime.maximumExclusive,
    ) < 0
  );
}

/** Checks a validated pack's closed bridge-protocol compatibility interval. */
export function packSupportsBridgeProtocol(
  manifest: PackManifest,
  version: number,
): boolean {
  if (!Number.isSafeInteger(version)) return false;
  const range = manifest.compatibility.bridgeProtocol;
  return version >= range.minimum && version <= range.maximum;
}
