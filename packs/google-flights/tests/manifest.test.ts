import { verifyPackFixtures } from "@mcpatch/sdk";
import { describe, expect, it } from "vitest";

import {
  FLIGHTS_CURRENT_SEARCH,
  FLIGHTS_PRICE_INSIGHTS,
  FLIGHTS_RESULTS,
  googleFlightsPack,
} from "../src/index.js";

describe("Google Flights reviewed pack manifest", () => {
  it("declares only exact Google Flights locations and read-only local behavior", () => {
    expect(googleFlightsPack.manifest.matches).toEqual([
      {
        origin: "https://www.google.com",
        paths: [
          { kind: "exact", path: "/travel/flights" },
          { kind: "exact", path: "/travel/flights/search" },
        ],
      },
    ]);
    expect(googleFlightsPack.manifest.networkPolicy).toEqual({
      extensionRequests: "none",
    });
    expect(googleFlightsPack.manifest.tools).toHaveLength(3);
    expect(googleFlightsPack.manifest.tools).toEqual(
      expect.arrayContaining(
        [FLIGHTS_CURRENT_SEARCH, FLIGHTS_RESULTS, FLIGHTS_PRICE_INSIGHTS].map(
          (name) =>
            expect.objectContaining({
              name,
              risk: "read",
              permissions: ["READ"],
              inputSchema: {
                type: "object",
                additionalProperties: false,
                maxProperties: 0,
                properties: {},
              },
            }),
        ),
      ),
    );
  });

  it("keeps bundled fallback handlers fail closed and validates every schema", async () => {
    const result = await verifyPackFixtures(googleFlightsPack, {
      runtimeVersion: "0.1.0",
      bridgeProtocolVersion: 1,
      allowedPermissions: ["READ"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.passed).toBe(true);
    expect(result.evidence.summary).toEqual({
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
    });
  });
});
