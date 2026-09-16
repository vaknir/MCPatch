import { describe, expect, it, vi } from "vitest";

import {
  TradingViewPackError,
  createTradingViewSite,
  createTradingViewSymbolUrl,
  type TradingViewSemanticSnapshot,
  validateTradingViewChangeSymbolInput,
} from "../src/index.js";

describe("TradingView symbol navigation", () => {
  it("accepts exact canonical symbols and preserves the current chart path", () => {
    expect(
      validateTradingViewChangeSymbolInput({ symbol: "NASDAQ:AAPL" }),
    ).toEqual({ symbol: "NASDAQ:AAPL" });
    expect(
      createTradingViewSymbolUrl(
        "https://www.tradingview.com/chart/layout-id/?interval=60#view",
        { symbol: "NYSE:IBM" },
      ),
    ).toBe(
      "https://www.tradingview.com/chart/layout-id/?interval=60&symbol=NYSE%3AIBM#view",
    );
  });

  it("rejects ambiguous identifiers and non-chart origins", () => {
    for (const symbol of ["AAPL", "NASDAQ:aapl", "NASDAQ:AAPL:USD", ""]) {
      expect(() => validateTradingViewChangeSymbolInput({ symbol })).toThrow(
        TradingViewPackError,
      );
    }
    expect(() =>
      createTradingViewSymbolUrl("https://example.com/chart/", {
        symbol: "NASDAQ:AAPL",
      }),
    ).toThrow(TradingViewPackError);
  });

  it("routes one validated action through the narrow site source", async () => {
    const changeSymbol = vi.fn();
    const site = createTradingViewSite({
      read: compatibleSnapshot,
      changeSymbol,
    });
    const signal = new AbortController().signal;

    await expect(
      site.changeSymbol({ symbol: "NASDAQ:AAPL" }, signal),
    ).resolves.toEqual({
      fingerprint: "tradingview-chart-semantic-en-v1",
      state: "accepted",
      symbol: "NASDAQ:AAPL",
    });
    expect(changeSymbol).toHaveBeenCalledWith(
      { symbol: "NASDAQ:AAPL" },
      signal,
    );
    await expect(
      site.changeSymbol({ symbol: "NYSE:IBM" }, signal),
    ).rejects.toMatchObject({
      code: "EXECUTION_FAILED",
      reason: "navigation_already_started",
    });
    expect(changeSymbol).toHaveBeenCalledTimes(1);
  });

  it("cancels before dispatch", async () => {
    const changeSymbol = vi.fn();
    const site = createTradingViewSite({
      read: compatibleSnapshot,
      changeSymbol,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      site.changeSymbol({ symbol: "NASDAQ:AAPL" }, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(changeSymbol).not.toHaveBeenCalled();
  });

  it("revalidates the current document before scheduling navigation", async () => {
    const changeSymbol = vi.fn();
    const site = createTradingViewSite({
      read: () => ({ ...compatibleSnapshot(), origin: "https://example.com" }),
      changeSymbol,
    });

    await expect(
      site.changeSymbol({ symbol: "NYSE:IBM" }, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "TOOL_UNAVAILABLE",
      reason: "unsupported_origin",
    });
    expect(changeSymbol).not.toHaveBeenCalled();
  });

  it("does not republish capabilities for quote-only page mutations", async () => {
    let current = compatibleSnapshot();
    let refresh: (() => void) | undefined;
    const read = vi.fn(() => current);
    const site = createTradingViewSite({
      read,
      changeSymbol: vi.fn(),
      subscribe: (listener) => {
        refresh = listener;
        return () => undefined;
      },
    });
    const listener = vi.fn();

    await site.capabilities(new AbortController().signal);
    site.subscribe(listener);
    refresh?.();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(listener).not.toHaveBeenCalled();

    current = { ...current, origin: "https://example.com" };
    refresh?.();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(listener).not.toHaveBeenCalled();
    refresh?.();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
  });
});

function compatibleSnapshot(): TradingViewSemanticSnapshot {
  return {
    origin: "https://www.tradingview.com",
    pathname: "/chart/",
    language: "en",
    documentTitle: "AAPL 101.50 current chart",
    symbolParameter: "NASDAQ:AAPL",
    charts: [
      {
        names: ["Apple Inc"],
        intervals: ["1D"],
        exchanges: ["NASDAQ"],
        canvasLabels: ["Chart for BATS:AAPL, 1 day"],
        ohlc: ["O100", "H102", "L99", "C101"],
        changes: ["1 (1%)"],
        volumes: ["1 M"],
        currencies: ["USD"],
      },
    ],
  };
}
