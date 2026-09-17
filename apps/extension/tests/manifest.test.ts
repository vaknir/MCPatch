import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DECLARED_OPTIONAL_ORIGINS } from "../src/bundled-packs.js";

const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const EXPECTED_EXTENSION_ID = "imbnpameklobbabbkfkalcfcggpjacdi";

function deriveChromiumExtensionId(publicKeyDer: Uint8Array): string {
  const hexadecimal = createHash("sha256")
    .update(publicKeyDer)
    .digest("hex")
    .slice(0, 32);
  return [...hexadecimal]
    .map((digit) =>
      String.fromCharCode("a".charCodeAt(0) + Number.parseInt(digit, 16)),
    )
    .join("");
}

describe("extension manifest", () => {
  it("is an ES-module Manifest V3 service worker", () => {
    expect(manifest["manifest_version"]).toBe(3);
    expect(manifest["background"]).toEqual({
      service_worker: "service-worker.js",
      type: "module",
    });
  });

  it("grants no ambient website authority and requests discovered HTTPS origins only at runtime", () => {
    expect(Object.keys(manifest).sort()).toEqual([
      "action",
      "background",
      "description",
      "key",
      "manifest_version",
      "minimum_chrome_version",
      "name",
      "optional_host_permissions",
      "options_ui",
      "permissions",
      "version",
    ]);
    expect(manifest["minimum_chrome_version"]).toBe("106");
    // Exact set: `activeTab` plus `scripting` would let a toolbar click run
    // code on any page, so it is deliberately absent.
    expect(manifest["permissions"]).toEqual([
      "nativeMessaging",
      "scripting",
      "storage",
    ]);
    expect(manifest["optional_host_permissions"]).toEqual(["https://*/*"]);
    expect(
      DECLARED_OPTIONAL_ORIGINS.every(
        (origin) => new URL(origin).origin === origin && !origin.includes("*"),
      ),
    ).toBe(true);
    expect(manifest["action"]).toEqual({ default_title: "MCPatch" });
    expect(manifest["options_ui"]).toEqual({
      page: "developer.html",
      open_in_tab: true,
    });
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("externally_connectable");
    expect(manifest).not.toHaveProperty("web_accessible_resources");
  });

  it("keeps the approval page unreachable from web content", () => {
    // A page can only load, frame, or fetch an extension resource that the
    // manifest lists as web accessible, and can only message the worker
    // through externally_connectable. Neither exists, so the trusted approval
    // page and its port are reachable from extension pages alone.
    expect(manifest).not.toHaveProperty("web_accessible_resources");
    expect(manifest).not.toHaveProperty("externally_connectable");
    expect(JSON.stringify(manifest)).not.toContain("approval.html");
  });

  it("keeps the local developer surface unreachable from web content", () => {
    expect(manifest).not.toHaveProperty("web_accessible_resources");
    expect(manifest).not.toHaveProperty("externally_connectable");
    expect(manifest["options_ui"]).toEqual({
      page: "developer.html",
      open_in_tab: true,
    });
  });

  it("derives one stable ID from a committed public identity", () => {
    const encodedKey = manifest["key"];
    expect(typeof encodedKey).toBe("string");
    const publicKeyDer = Buffer.from(encodedKey as string, "base64");
    const publicKey = createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });

    expect(publicKey.asymmetricKeyType).toBe("rsa");
    expect(deriveChromiumExtensionId(publicKeyDer)).toBe(EXPECTED_EXTENSION_ID);
    expect(encodedKey).not.toContain("PRIVATE");
  });
});
