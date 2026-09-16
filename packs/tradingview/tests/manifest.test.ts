import { verifyPackFixtures } from "@mcpatch/sdk";
import { describe, expect, it } from "vitest";

import {
  TRADINGVIEW_CHANGE_SYMBOL,
  TRADINGVIEW_CURRENT_CHART,
  TRADINGVIEW_CURRENT_WATCHLIST,
  TRADINGVIEW_ORIGIN,
  tradingViewPack,
} from "../src/index.js";

describe("TradingView reviewed pack manifest", () => {
  it("declares one exact origin and only reviewed browser tools", () => {
    expect(tradingViewPack.manifest.matches).toEqual([
      {
        origin: TRADINGVIEW_ORIGIN,
        paths: [{ kind: "prefix", path: "/chart/" }],
      },
    ]);
    expect(tradingViewPack.manifest.networkPolicy).toEqual({
      extensionRequests: "none",
    });
    expect(tradingViewPack.manifest.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: TRADINGVIEW_CURRENT_CHART,
          risk: "read",
          permissions: ["READ"],
        }),
        expect.objectContaining({
          name: TRADINGVIEW_CURRENT_WATCHLIST,
          risk: "read",
          permissions: ["READ"],
        }),
        expect.objectContaining({
          name: TRADINGVIEW_CHANGE_SYMBOL,
          risk: "action",
          permissions: ["ACTION"],
        }),
      ]),
    );
  });

  it("keeps every service-worker handler fail closed", async () => {
    const result = await verifyPackFixtures(tradingViewPack, {
      runtimeVersion: "0.1.0",
      bridgeProtocolVersion: 1,
      allowedPermissions: ["READ", "ACTION"],
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
