import type { PackMatch } from "@mcpatch/sdk/runtime";

/**
 * Chrome match patterns for one reviewed pack site.
 *
 * Enabling a pack used to register its content script for the whole origin,
 * so a bundle that declares `/travel/flights` still ran on every page of the
 * host and only then decided to publish nothing. Deriving the patterns from
 * the manifest's own path rules shrinks the injected surface to what the pack
 * declared, and a pack that genuinely wants the host has to say so through
 * `wholeOrigin`.
 *
 * Chrome grants host permissions per origin regardless, so this narrows where
 * code runs, not what the user was asked to grant.
 */
export function contentScriptMatches(match: PackMatch): readonly string[] {
  const patterns = match.paths.map((rule) =>
    rule.kind === "prefix"
      ? `${match.origin}${prefixPattern(rule.path)}`
      : `${match.origin}${rule.path}`,
  );
  return Object.freeze([...new Set(patterns)].sort());
}

/**
 * A prefix rule covers the prefix itself and everything under it. `/` is the
 * whole-origin case, which the manifest had to declare explicitly.
 */
function prefixPattern(path: string): string {
  return path === "/" ? "/*" : `${path}*`;
}
