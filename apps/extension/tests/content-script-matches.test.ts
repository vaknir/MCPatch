import { describe, expect, it } from "vitest";

import { googleFlightsPack } from "@mcpatch/google-flights-pack";

import { contentScriptMatches } from "../src/content-script-matches.js";

const ORIGIN = "https://www.google.com";

describe("content script matches", () => {
  it("registers an exact path as itself and a prefix as a subtree", () => {
    expect(
      contentScriptMatches({
        origin: ORIGIN,
        paths: [
          { kind: "exact", path: "/travel/flights" },
          { kind: "prefix", path: "/travel/search/" },
        ],
      }),
    ).toEqual([`${ORIGIN}/travel/flights`, `${ORIGIN}/travel/search/*`]);
  });

  it("does not cover the rest of the host", () => {
    const patterns = contentScriptMatches({
      origin: ORIGIN,
      paths: [{ kind: "exact", path: "/travel/flights" }],
    });
    expect(patterns).not.toContain(`${ORIGIN}/*`);
    expect(patterns.some((pattern) => pattern.endsWith("/*"))).toBe(false);
  });

  it("covers the host only for a match that declared the whole origin", () => {
    expect(
      contentScriptMatches({
        origin: ORIGIN,
        paths: [{ kind: "prefix", path: "/" }],
        wholeOrigin: true,
      }),
    ).toEqual([`${ORIGIN}/*`]);
  });

  it("is deterministic and free of duplicates", () => {
    expect(
      contentScriptMatches({
        origin: ORIGIN,
        paths: [
          { kind: "prefix", path: "/travel/" },
          { kind: "exact", path: "/a" },
          { kind: "prefix", path: "/travel/" },
        ],
      }),
    ).toEqual([`${ORIGIN}/a`, `${ORIGIN}/travel/*`]);
  });

  it("keeps the shipped Google Flights pack off the rest of google.com", () => {
    const match = googleFlightsPack.manifest.matches[0];
    if (match === undefined) throw new Error("missing Google Flights match");
    const patterns = contentScriptMatches(match);

    expect(patterns).toEqual([
      `${ORIGIN}/travel/flights`,
      `${ORIGIN}/travel/flights/search`,
    ]);
    // Search, Mail and every other page on the host stay uninjected.
    expect(patterns).not.toContain(`${ORIGIN}/*`);
  });
});
