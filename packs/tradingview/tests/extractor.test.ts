import { describe, expect, it } from "vitest";

import {
  TRADINGVIEW_CHANGE_SYMBOL,
  TRADINGVIEW_CURRENT_CHART,
  TRADINGVIEW_CURRENT_WATCHLIST,
  TradingViewPackError,
  discoverTradingViewTools,
  extractTradingViewCurrentChart,
  extractTradingViewCurrentWatchlist,
  type TradingViewSemanticSnapshot,
} from "../src/index.js";

describe("TradingView semantic extraction", () => {
  it("extracts one exact chart and normalizes numeric values", () => {
    expect(extractTradingViewCurrentChart(snapshot())).toEqual({
      fingerprint: "tradingview-chart-semantic-en-v1",
      symbol: "NASDAQ:AAPL",
      ticker: "AAPL",
      exchange: "NASDAQ",
      name: "Apple Inc",
      interval: "1D",
      currency: "USD",
      open: 330.14,
      high: 331.78,
      low: 328.35,
      close: 331.34,
      price: 332.01,
      change: -1.74,
      changePercent: -0.52,
      volume: "31.75 M",
    });
  });

  it("extracts bounded canonical watchlist rows", () => {
    expect(extractTradingViewCurrentWatchlist(snapshot())).toEqual({
      fingerprint: "tradingview-chart-semantic-en-v1",
      items: [
        {
          symbol: "NASDAQ:AAPL",
          ticker: "AAPL",
          price: 331.34,
          change: -1.74,
          changePercent: -0.52,
          volume: "31.75 M",
          marketStatus: "Overnight",
          active: true,
        },
        {
          symbol: "NYSE:IBM",
          ticker: "IBM",
          price: 261.2,
          change: 1.15,
          changePercent: 0.44,
          marketStatus: "Market closed",
          active: false,
        },
      ],
    });
  });

  it("discovers only compatible capabilities", () => {
    expect(discoverTradingViewTools(snapshot(), true)).toEqual([
      TRADINGVIEW_CURRENT_CHART,
      TRADINGVIEW_CURRENT_WATCHLIST,
      TRADINGVIEW_CHANGE_SYMBOL,
    ]);
    expect(discoverTradingViewTools(snapshot(false), false)).toEqual([
      TRADINGVIEW_CURRENT_CHART,
    ]);
  });

  it("fails closed for ambiguous charts and conflicting symbols", () => {
    const compatible = snapshot();
    const [chart] = compatible.charts;
    if (chart === undefined) throw new Error("fixture chart is missing");

    expectPackError(
      () =>
        extractTradingViewCurrentChart({
          ...compatible,
          charts: [chart, chart],
        }),
      "ambiguous_chart",
    );
    expectPackError(
      () =>
        extractTradingViewCurrentChart({
          ...snapshot(),
          symbolParameter: "NYSE:AAPL",
        }),
      "invalid_symbol",
    );
    expectPackError(
      () =>
        extractTradingViewCurrentChart({
          ...compatible,
          charts: [
            {
              ...chart,
              canvasLabels: ["Chart for BATS:IBM, 1 day"],
            },
          ],
        }),
      "invalid_symbol",
    );
  });

  it("rejects unsupported origins, paths, and locales", () => {
    expectPackError(
      () =>
        extractTradingViewCurrentChart({
          ...snapshot(),
          origin: "https://example.com",
        }),
      "unsupported_origin",
    );
    expectPackError(
      () =>
        extractTradingViewCurrentChart({
          ...snapshot(),
          pathname: "/markets/",
        }),
      "unsupported_path",
    );
    expectPackError(
      () => extractTradingViewCurrentChart({ ...snapshot(), language: "fr" }),
      "unsupported_locale",
    );
  });
});

function snapshot(includeWatchlist = true): TradingViewSemanticSnapshot {
  return {
    origin: "https://www.tradingview.com",
    pathname: "/chart/",
    language: "en",
    documentTitle: "AAPL 332.01 ▼ −0.52%",
    charts: [
      {
        names: ["Apple Inc"],
        intervals: ["1D"],
        exchanges: ["NASDAQ"],
        canvasLabels: ["Chart for BATS:AAPL, 1 day"],
        ohlc: ["O330.14", "H331.78", "L328.35", "C331.34"],
        changes: ["−1.74 (−0.52%)"],
        volumes: ["31.75 M"],
        currencies: ["USD"],
      },
    ],
    ...(includeWatchlist
      ? {
          watchlist: [
            {
              symbol: "NASDAQ:AAPL",
              ticker: "AAPL",
              values: ["331.34", "−1.74", "−0.52%", "31.75 M"],
              marketStatus: "Overnight",
              active: true,
            },
            {
              symbol: "NYSE:IBM",
              ticker: "IBM",
              values: ["261.20", "1.15", "0.44%"],
              marketStatus: "Market closed",
              active: false,
            },
          ],
        }
      : {}),
  };
}

function expectPackError(operation: () => unknown, reason: string): void {
  try {
    operation();
    expect.unreachable("extraction must fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TradingViewPackError);
    expect(error).toMatchObject({ code: "TOOL_UNAVAILABLE", reason });
  }
}
