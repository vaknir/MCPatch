import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DECLARED_SITE_ORIGINS } from "../src/bundled-packs.js";

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
      "action",
      "background",
      "description",
      "manifest_version",
      "minimum_chrome_version",
      "name",
      "optional_host_permissions",
      "permissions",
      "version",
    ]);
    expect(manifest["minimum_chrome_version"]).toBe("106");
    expect(manifest["permissions"]).toEqual([
      "activeTab",
      "nativeMessaging",
      "scripting",
      "storage",
    ]);
    expect(manifest["optional_host_permissions"]).toEqual(
      DECLARED_SITE_ORIGINS.map((origin) => `${origin}/*`),
    );
    expect(
      DECLARED_SITE_ORIGINS.every(
        (origin) => new URL(origin).origin === origin && !origin.includes("*"),
      ),
    ).toBe(true);
    expect(manifest["action"]).toEqual({ default_title: "MCPatch" });
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("externally_connectable");
  });
});
