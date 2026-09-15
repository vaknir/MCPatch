import { describe, expect, it } from "vitest";

import {
  canonicalizePageLocation,
  packMatchesLocation,
  type PackManifest,
} from "../src/index.js";
import { pack } from "./support/pack.js";

describe("pack location matching", () => {
  it("canonicalizes the exact HTTPS origin separately from the path", () => {
    expect(
      canonicalizePageLocation(
        "HTTPS://EXAMPLE.COM:443/items/current?currency=US%20D",
      ),
    ).toEqual({
      ok: true,
      location: {
        origin: "https://example.com",
        path: "/items/current",
      },
    });
    expect(
      canonicalizePageLocation("https://bücher.example/items/current"),
    ).toEqual({
      ok: true,
      location: {
        origin: "https://xn--bcher-kva.example",
        path: "/items/current",
      },
    });
  });

  it.each([
    "http://example.com/items/",
    "data:text/plain,opaque",
    "https://user:secret@example.com/items/",
    "https://*.example.com/items/",
    "https://example.com/items/#fragment",
    "https://example.com/items/%66oo",
    "https://example.com/items/%2e%2e/admin",
    "https://example.com/items/?value=%GG",
    "https://example.com\\items/",
    " https://example.com/items/",
  ])("rejects an unsafe or ambiguous page URL: %s", (url) => {
    expect(canonicalizePageLocation(url)).toEqual({
      ok: false,
      issue: { code: "INVALID_LOCATION", field: "url" },
    });
  });

  it("applies exact and prefix paths without using query parameters", () => {
    const candidate = pack({
      id: "paths",
      paths: [
        { kind: "exact", path: "/exact" },
        { kind: "prefix", path: "/items/" },
      ],
      tools: ["acme.paths.read"],
    });

    expect(matches(candidate, "https://example.com/exact?ignored=yes")).toBe(
      true,
    );
    expect(matches(candidate, "https://example.com/exact/")).toBe(false);
    expect(matches(candidate, "https://example.com/items/one")).toBe(true);
    expect(matches(candidate, "https://example.com/items")).toBe(false);
    expect(matches(candidate, "https://example.com/itemss/one")).toBe(false);
    expect(matches(candidate, "https://example.com.evil/items/one")).toBe(
      false,
    );
  });

  it("keeps non-default ports and canonical Unicode hosts exact", () => {
    const port = pack({
      id: "port",
      origin: "https://example.com:8443",
      tools: ["acme.port.read"],
    });
    const unicode = pack({
      id: "unicode",
      origin: "https://xn--bcher-kva.example",
      tools: ["acme.unicode.read"],
    });

    expect(matches(port, "https://example.com:8443/items/one")).toBe(true);
    expect(matches(port, "https://example.com/items/one")).toBe(false);
    expect(matches(unicode, "https://bücher.example/items/one")).toBe(true);
  });
});

function matches(manifest: PackManifest, url: string): boolean {
  const result = canonicalizePageLocation(url);
  if (!result.ok) return false;
  return packMatchesLocation(manifest, result.location);
}
