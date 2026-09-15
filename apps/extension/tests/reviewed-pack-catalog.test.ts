import { demoPack } from "@mcpatch/example-packs";
import { describe, expect, it } from "vitest";

import {
  createEnablementState,
  parseEnablementState,
} from "../src/enablement-storage.js";
import {
  createReviewedPackCatalog,
  recordForSite,
} from "../src/reviewed-pack-catalog.js";
import {
  runtimeOptions,
  SITE_ORIGIN,
  testCatalog,
} from "./support/site-pack.js";

describe("reviewed pack site catalog", () => {
  it("admits only reviewed origins declared in the extension", () => {
    const catalog = testCatalog();

    expect(catalog.sites).toHaveLength(1);
    expect(catalog.sites[0]).toMatchObject({
      key: `mcpatch/site-demo@${SITE_ORIGIN}`,
      origin: SITE_ORIGIN,
      permissionPattern: `${SITE_ORIGIN}/*`,
    });
    expect(catalog.sites[0]?.registrationId).toMatch(/^mcpatch-v1-[a-f0-9]+$/);
    expect(catalog.match(`${SITE_ORIGIN}/app/search?q=1`)).toHaveLength(1);
    expect(catalog.match(`${SITE_ORIGIN}/outside`)).toEqual([]);
    expect(catalog.match("https://attacker.example/app")).toEqual([]);
  });

  it("rejects undeclared, wildcard, duplicate, and malformed origin authority", () => {
    expect(() => testCatalog([])).toThrow(TypeError);
    expect(() => testCatalog(["https://*.example.com"])).toThrow(TypeError);
    expect(() => testCatalog([SITE_ORIGIN, SITE_ORIGIN])).toThrow(TypeError);
    expect(() => testCatalog(["http://example.com"])).toThrow(TypeError);
  });

  it("excludes the synthetic .invalid pack from site authority", () => {
    const catalog = createReviewedPackCatalog([demoPack], runtimeOptions(), []);
    expect(catalog.sites).toEqual([]);
  });
});

describe("enablement storage v1", () => {
  it("round-trips sorted exact records and resolves only the installed build", () => {
    const catalog = testCatalog();
    const site = catalog.sites[0];
    if (site === undefined) throw new Error("missing site fixture");
    const record = recordForSite(site);
    const state = createEnablementState([record]);

    expect(parseEnablementState(structuredClone(state))).toEqual(state);
    expect(catalog.resolve(record)).toBe(site);
    expect(catalog.resolve({ ...record, version: "0.1.1" })).toBeUndefined();
    expect(
      catalog.resolve({ ...record, digest: `sha256:${"0".repeat(64)}` }),
    ).toBeUndefined();
  });

  it.each([
    undefined,
    {},
    { stateVersion: 2, enabled: [] },
    { stateVersion: 1, enabled: "all" },
    {
      stateVersion: 1,
      enabled: [
        {
          publisher: "mcpatch",
          id: "site-demo",
          version: "0.1.0",
          digest: `sha256:${"0".repeat(64)}`,
          origin: "https://*.example.com",
        },
      ],
    },
  ])("rejects corrupted or wildcard state %#", (value) => {
    expect(parseEnablementState(value)).toBeUndefined();
  });

  it("rejects accessors without invoking them", () => {
    let accessed = false;
    const value = { stateVersion: 1 };
    Object.defineProperty(value, "enabled", {
      enumerable: true,
      get() {
        accessed = true;
        return [];
      },
    });

    expect(parseEnablementState(value)).toBeUndefined();
    expect(accessed).toBe(false);
  });
});
