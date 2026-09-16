import {
  TRADINGVIEW_CHART_PATH,
  TRADINGVIEW_ORIGIN,
  TRADINGVIEW_TOOLS,
  tradingViewBrowserPack,
  tradingViewPack,
} from "@mcpatch/tradingview-pack";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUNDLED_PAGE_ADAPTERS } from "../src/bundled-page-adapters.js";
import {
  BUNDLED_PACKS,
  DECLARED_SITE_ORIGINS,
  PACK_RUNTIME_OPTIONS,
} from "../src/bundled-packs.js";
import { createReviewedPackCatalog } from "../src/reviewed-pack-catalog.js";

describe("bundled TradingView production pack", () => {
  it("uses the generated page definition without extension-local wiring", () => {
    const definition = BUNDLED_PAGE_ADAPTERS.find(
      (candidate) => candidate.pack === tradingViewPack,
    );
    expect(definition).toBe(tradingViewBrowserPack.page);
    expect(definition?.tools).toEqual(TRADINGVIEW_TOOLS);
    expect(BUNDLED_PACKS).toContain(tradingViewPack);
    expect(PACK_RUNTIME_OPTIONS.allowedPermissions).toEqual(["READ", "ACTION"]);
  });

  it("matches only exact TradingView chart paths under declared authority", () => {
    const catalog = createReviewedPackCatalog(
      BUNDLED_PACKS,
      PACK_RUNTIME_OPTIONS,
      DECLARED_SITE_ORIGINS,
    );
    expect(DECLARED_SITE_ORIGINS).toContain(TRADINGVIEW_ORIGIN);
    expect(
      catalog.match(`${TRADINGVIEW_ORIGIN}${TRADINGVIEW_CHART_PATH}`),
    ).toHaveLength(1);
    expect(
      catalog.match(`${TRADINGVIEW_ORIGIN}${TRADINGVIEW_CHART_PATH}layout-id/`),
    ).toHaveLength(1);
    expect(catalog.match(`${TRADINGVIEW_ORIGIN}/markets/`)).toEqual([]);
    expect(catalog.match("https://tradingview.com/chart/")).toEqual([]);
  });

  it("declares only optional site authority in the extension manifest", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest["optional_host_permissions"]).toContain(
      `${TRADINGVIEW_ORIGIN}/*`,
    );
    expect(manifest).not.toHaveProperty("host_permissions");
  });
});
