import { readFileSync } from "node:fs";

import {
  GOOGLE_FLIGHTS_LANDING_PATH,
  GOOGLE_FLIGHTS_ORIGIN,
  GOOGLE_FLIGHTS_SEARCH_PATH,
  GOOGLE_FLIGHTS_TOOLS,
  googleFlightsBrowserPack,
  googleFlightsPack,
} from "@mcpatch/google-flights-pack";
import { describe, expect, it } from "vitest";

import { BUNDLED_PAGE_ADAPTERS } from "../src/bundled-page-adapters.js";
import {
  BUNDLED_PACKS,
  DECLARED_OPTIONAL_ORIGINS,
  PACK_RUNTIME_OPTIONS,
} from "../src/bundled-packs.js";
import { createReviewedPackCatalog } from "../src/reviewed-pack-catalog.js";

describe("bundled Google Flights production pack", () => {
  it("binds one static adapter definition to the exact reviewed manifest tools", () => {
    const definition = BUNDLED_PAGE_ADAPTERS.find(
      (candidate) => candidate.pack === googleFlightsPack,
    );
    expect(definition).toBeDefined();
    expect(definition).toBe(googleFlightsBrowserPack.page);
    expect(definition?.tools).toEqual(GOOGLE_FLIGHTS_TOOLS);
    expect(typeof definition?.create).toBe("function");
    expect(BUNDLED_PACKS).toContain(googleFlightsPack);
    expect(PACK_RUNTIME_OPTIONS.allowedPermissions).toEqual([
      "READ",
      "ACTION",
      "EXTERNAL_NETWORK",
    ]);
  });

  it("makes only the two exact paths enableable under one declared origin", () => {
    const catalog = createReviewedPackCatalog(
      BUNDLED_PACKS,
      PACK_RUNTIME_OPTIONS,
      DECLARED_OPTIONAL_ORIGINS,
    );
    expect(DECLARED_OPTIONAL_ORIGINS).toContain(GOOGLE_FLIGHTS_ORIGIN);
    expect(
      catalog.match(`${GOOGLE_FLIGHTS_ORIGIN}${GOOGLE_FLIGHTS_LANDING_PATH}`),
    ).toHaveLength(1);
    expect(
      catalog.match(`${GOOGLE_FLIGHTS_ORIGIN}${GOOGLE_FLIGHTS_SEARCH_PATH}`),
    ).toHaveLength(1);
    expect(catalog.match(`${GOOGLE_FLIGHTS_ORIGIN}/maps`)).toEqual([]);
    expect(catalog.match("https://google.com/travel/flights")).toEqual([]);
  });

  it("keeps the production manifest at optional exact-origin authority", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest["optional_host_permissions"]).toContain(
      `${GOOGLE_FLIGHTS_ORIGIN}/*`,
    );
    expect(manifest).not.toHaveProperty("host_permissions");
  });
});
