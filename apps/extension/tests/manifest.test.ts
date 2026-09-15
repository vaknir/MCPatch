import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("extension manifest", () => {
  it("is an ES-module Manifest V3 service worker", () => {
    expect(manifest["manifest_version"]).toBe(3);
    expect(manifest["background"]).toEqual({
      service_worker: "service-worker.js",
      type: "module",
    });
  });

  it("grants only native messaging and no website authority", () => {
    expect(Object.keys(manifest).sort()).toEqual([
      "background",
      "description",
      "manifest_version",
      "minimum_chrome_version",
      "name",
      "permissions",
      "version",
    ]);
    expect(manifest["minimum_chrome_version"]).toBe("106");
    expect(manifest["permissions"]).toEqual(["nativeMessaging"]);
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("externally_connectable");
  });
});
