import { readFileSync } from "node:fs";

import { verifyPackFixtures } from "@mcpatch/sdk";
import { describe, expect, it } from "vitest";

import { demoPack } from "../src/index.js";

describe("reviewed synthetic demo pack", () => {
  it("matches the canonical bundled manifest fixture", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../../packages/sdk/fixtures/v1/valid/bundled-demo.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;

    expect(demoPack.manifest).toEqual(fixture);
  });

  it("passes manifest, compatibility, schema, permission, and fixture checks", async () => {
    const result = await verifyPackFixtures(demoPack, {
      runtimeVersion: "0.1.0",
      bridgeProtocolVersion: 1,
      allowedPermissions: ["READ"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.passed).toBe(true);
    expect(result.evidence.summary).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
    });
  });
});
