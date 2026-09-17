const ALL_URLS = "<all_urls>";
const MATCH_PATTERN = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/u;

/**
 * Proves that the browser granted exactly the patterns a site needs.
 *
 * `permissions.contains` is not sufficient once the manifest declares a broad
 * optional pattern for runtime-configured origins: a broader granted pattern
 * satisfies an exact-looking query, so a site could appear authorized on the
 * strength of authority the user never granted for it. This reads the complete
 * `permissions.getAll()` origin inventory instead, requires each exact pattern
 * itself, and fails closed when a covering grant is present.
 *
 * Failing closed is the whole behavior here: MCPatch never reduces or removes a
 * covering grant on the user's behalf, it simply refuses to treat one as proof.
 *
 * See ADR 0014 and ADR 0015.
 */
export function provesExactOrigins(
  granted: readonly string[],
  required: readonly string[],
): boolean {
  if (!Array.isArray(granted) || required.length === 0) return false;
  const inventory = new Set(granted);
  if (required.some((pattern) => !inventory.has(pattern))) return false;
  return !granted.some((pattern) => covers(pattern, required));
}

function covers(pattern: string, required: readonly string[]): boolean {
  if (required.includes(pattern)) return false;
  if (pattern === ALL_URLS) return true;
  const host = patternHost(pattern);
  if (host === undefined) return false;
  if (host === "*") return true;
  if (!host.startsWith("*.")) return false;
  const suffix = host.slice(1);
  return required.some((exact) => {
    const exactHost = patternHost(exact);
    return (
      exactHost !== undefined &&
      (exactHost.endsWith(suffix) || `.${exactHost}` === suffix)
    );
  });
}

function patternHost(value: string): string | undefined {
  const match = MATCH_PATTERN.exec(value);
  return match?.[2];
}
