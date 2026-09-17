import { describe, expect, it } from "vitest";

import {
  EMPTY_ORIGIN_CONFIG,
  ORIGIN_CONFIG_STORAGE_KEY,
  parseOriginConfigState,
} from "../src/configured-origins.js";

const SITE = {
  publisher: "jira",
  id: "jira-data-center",
  origin: "https://jira.corp.example.com",
};

function state(sites: readonly unknown[]): unknown {
  return { stateVersion: 1, sites };
}

describe("configured pack origins", () => {
  it("accepts a bounded canonical configuration", () => {
    expect(parseOriginConfigState(state([SITE]))).toEqual({
      stateVersion: 1,
      sites: [SITE],
    });
  });

  it("uses a stable storage key and an empty default", () => {
    expect(ORIGIN_CONFIG_STORAGE_KEY).toBe("mcpatch.origins.v1");
    expect(EMPTY_ORIGIN_CONFIG.sites).toEqual([]);
  });

  it("orders sites so reconciliation converges", () => {
    const second = { ...SITE, origin: "https://a.example.com" };
    const parsed = parseOriginConfigState(state([SITE, second]));

    expect(parsed?.sites.map((site) => site.origin)).toEqual([
      "https://a.example.com",
      "https://jira.corp.example.com",
    ]);
  });

  it.each([
    ["a wildcard origin", { ...SITE, origin: "https://*.example.com" }],
    ["a plaintext origin", { ...SITE, origin: "http://jira.example.com" }],
    ["an origin with a path", { ...SITE, origin: "https://example.com/jira" }],
    ["an origin with credentials", { ...SITE, origin: "https://u:p@e.com" }],
    ["a synthetic origin", { ...SITE, origin: "https://jira.example.invalid" }],
    ["an unknown field", { ...SITE, label: "corp" }],
    ["a malformed publisher", { ...SITE, publisher: "Jira" }],
  ])("rejects %s", (_label, site) => {
    expect(parseOriginConfigState(state([site]))).toBeUndefined();
  });

  it("rejects duplicates and oversized configurations", () => {
    expect(parseOriginConfigState(state([SITE, SITE]))).toBeUndefined();
    expect(
      parseOriginConfigState(
        state(
          Array.from({ length: 9 }, (_value, index) => ({
            ...SITE,
            origin: `https://jira${index}.example.com`,
          })),
        ),
      ),
    ).toBeUndefined();
  });

  it("rejects a malformed or accessor-backed envelope", () => {
    expect(
      parseOriginConfigState({ stateVersion: 2, sites: [] }),
    ).toBeUndefined();
    expect(parseOriginConfigState(null)).toBeUndefined();
    const hostile = { stateVersion: 1 };
    Object.defineProperty(hostile, "sites", { get: () => [SITE] });
    expect(parseOriginConfigState(hostile)).toBeUndefined();
  });
});
