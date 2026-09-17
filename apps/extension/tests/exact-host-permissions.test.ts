import { describe, expect, it } from "vitest";

import {
  hasExactHostPermissions,
  isExactHttpsPattern,
} from "../src/exact-host-permissions.js";
import { FakePermissions } from "./support/enablement.js";

describe("exact host permission inventory", () => {
  it("accepts only explicitly inventoried exact HTTPS origins", async () => {
    const permissions = new FakePermissions();
    permissions.granted.add("https://example.com/*");
    permissions.granted.add("https://[2001:db8::1]:8443/*");

    await expect(
      hasExactHostPermissions(permissions, [
        "https://example.com/*",
        "https://[2001:db8::1]:8443/*",
      ]),
    ).resolves.toBe(true);
  });

  it.each([
    "https://*/*",
    "https://*.example.com/*",
    "<all_urls>",
    "http://example.com/*",
    "https://user@example.com/*",
    "https://example.com/path/*",
  ])("rejects non-exact host pattern %s", (pattern) => {
    expect(isExactHttpsPattern(pattern)).toBe(false);
  });

  it("does not accept a broad grant as proof of an exact grant", async () => {
    const permissions = new FakePermissions();
    permissions.inventoryOrigins = ["https://*/*", "<all_urls>"];

    await expect(
      hasExactHostPermissions(permissions, ["https://example.com/*"]),
    ).resolves.toBe(false);
  });

  it("fails closed on duplicates, incomplete inventory, and API failure", async () => {
    const permissions = new FakePermissions();
    permissions.granted.add("https://example.com/*");
    await expect(
      hasExactHostPermissions(permissions, [
        "https://example.com/*",
        "https://example.com/*",
      ]),
    ).resolves.toBe(false);
    await expect(
      hasExactHostPermissions(permissions, [
        "https://example.com/*",
        "https://api.example.com/*",
      ]),
    ).resolves.toBe(false);
    permissions.throwGetAll = true;
    await expect(
      hasExactHostPermissions(permissions, ["https://example.com/*"]),
    ).resolves.toBe(false);
  });
});
