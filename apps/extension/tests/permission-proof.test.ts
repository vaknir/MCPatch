import { describe, expect, it } from "vitest";

import { provesExactOrigins } from "../src/permission-proof.js";

const EXACT = ["https://jira.corp.example.com/*"];

describe("exact origin permission proof", () => {
  it("accepts the exact granted pattern", () => {
    expect(provesExactOrigins(EXACT, EXACT)).toBe(true);
  });

  it("accepts an unrelated exact grant alongside it", () => {
    expect(
      provesExactOrigins(["https://www.tradingview.com/*", ...EXACT], EXACT),
    ).toBe(true);
  });

  it("requires every pattern a site needs", () => {
    const required = [...EXACT, "https://api.example.com/*"];
    expect(provesExactOrigins(EXACT, required)).toBe(false);
  });

  it.each([
    ["all hosts over https", "https://*/*"],
    ["all hosts over any scheme", "*://*/*"],
    ["all urls", "<all_urls>"],
    ["a covering wildcard subdomain", "https://*.example.com/*"],
    ["a covering wildcard apex", "https://*.corp.example.com/*"],
  ])(
    "refuses %s as proof even with the exact grant present",
    (_label, wide) => {
      expect(provesExactOrigins([...EXACT, wide], EXACT)).toBe(false);
    },
  );

  it("ignores a wildcard subdomain that does not cover the host", () => {
    expect(
      provesExactOrigins([...EXACT, "https://*.other.example.org/*"], EXACT),
    ).toBe(true);
  });

  it("refuses an empty requirement set", () => {
    expect(provesExactOrigins(EXACT, [])).toBe(false);
  });

  it("refuses a missing or malformed inventory", () => {
    expect(provesExactOrigins([], EXACT)).toBe(false);
    expect(provesExactOrigins(undefined as unknown as string[], EXACT)).toBe(
      false,
    );
  });
});
