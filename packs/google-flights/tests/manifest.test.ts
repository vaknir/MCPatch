import { verifyPackFixtures } from "@mcpatch/sdk";
import { describe, expect, it } from "vitest";

import {
  FLIGHTS_CURRENT_SEARCH,
  FLIGHTS_PRICE_INSIGHTS,
  FLIGHTS_RESULTS,
  FLIGHTS_SEARCH,
  googleFlightsPack,
} from "../src/index.js";

describe("Google Flights reviewed pack manifest", () => {
  it("declares only exact Google Flights locations and local behavior", () => {
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
    expect(googleFlightsPack.manifest.tools).toHaveLength(4);
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
    expect(googleFlightsPack.manifest.tools).toContainEqual(
      expect.objectContaining({
        name: FLIGHTS_SEARCH,
        risk: "action",
        permissions: ["ACTION"],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          maxProperties: 4,
          required: ["origin", "destination", "outboundDate", "returnDate"],
          properties: {
            origin: { type: "string", minLength: 3, maxLength: 3 },
            destination: { type: "string", minLength: 3, maxLength: 3 },
            outboundDate: { type: "string", minLength: 10, maxLength: 10 },
            returnDate: { type: "string", minLength: 10, maxLength: 10 },
          },
        },
      }),
    );
  });

  it("keeps bundled fallback handlers fail closed and validates every schema", async () => {
    const result = await verifyPackFixtures(googleFlightsPack, {
      runtimeVersion: "0.1.0",
      bridgeProtocolVersion: 2,
      allowedPermissions: ["READ", "ACTION"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.passed).toBe(true);
    expect(result.evidence.summary).toEqual({
      total: 4,
      passed: 4,
      failed: 0,
      skipped: 0,
    });
  });
});
