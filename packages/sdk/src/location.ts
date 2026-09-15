import type { PackManifest } from "./types.js";
import type {
  CanonicalPageLocation,
  PageLocationResult,
} from "./resolution-types.js";

const MAX_URL_LENGTH = 8_192;
const MAX_ORIGIN_LENGTH = 2_048;
const MAX_PATH_LENGTH = 4_096;

/** Canonicalizes a browser page URL into the two fields used for pack matching. */
export function canonicalizePageLocation(url: unknown): PageLocationResult {
  if (
    typeof url !== "string" ||
    url.length === 0 ||
    url.length > MAX_URL_LENGTH ||
    hasUnsafeLiteral(url) ||
    encodedBeforeQuery(url) ||
    /%(?![0-9A-Fa-f]{2})/.test(url)
  ) {
    return invalidLocation();
  }

  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== "" ||
      parsed.origin === "null" ||
      parsed.origin.length > MAX_ORIGIN_LENGTH ||
      parsed.pathname.length > MAX_PATH_LENGTH ||
      !isAscii(parsed.origin) ||
      !isAscii(parsed.pathname) ||
      parsed.pathname.includes("%") ||
      !parsed.pathname.startsWith("/")
    ) {
      return invalidLocation();
    }

    return Object.freeze({
      ok: true,
      location: Object.freeze({
        origin: parsed.origin,
        path: parsed.pathname,
      }),
    });
  } catch {
    return invalidLocation();
  }
}

/** Matches only an already validated manifest against a canonical location. */
export function packMatchesLocation(
  manifest: PackManifest,
  location: CanonicalPageLocation,
): boolean {
  return manifest.matches.some(
    (match) =>
      match.origin === location.origin &&
      match.paths.some((rule) =>
        rule.kind === "exact"
          ? location.path === rule.path
          : location.path.startsWith(rule.path),
      ),
  );
}

function invalidLocation(): PageLocationResult {
  return Object.freeze({
    ok: false,
    issue: Object.freeze({ code: "INVALID_LOCATION", field: "url" }),
  });
}

function isAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

function hasUnsafeLiteral(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code <= 0x20 || code === 0x7f || character === "\\" || character === "*"
    );
  });
}

function encodedBeforeQuery(value: string): boolean {
  const query = value.indexOf("?");
  const beforeQuery = query === -1 ? value : value.slice(0, query);
  return beforeQuery.includes("%");
}
