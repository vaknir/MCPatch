import { describe, expect, it, vi } from "vitest";

import {
  addTradingViewWatchlistSymbol,
  removeTradingViewWatchlistSymbol,
} from "../src/index.js";

describe("TradingView watchlist session actions", () => {
  it("appends one exact symbol and confirms it from the active list", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(active(["NASDAQ:AAPL"]))
      .mockResolvedValueOnce(json(["NASDAQ:AAPL", "NYSE:IBM"]))
      .mockResolvedValueOnce(active(["NASDAQ:AAPL", "NYSE:IBM"]));

    await expect(
      addTradingViewWatchlistSymbol(
        fetchRequest,
        { symbol: "NYSE:IBM" },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      fingerprint: "tradingview-chart-semantic-en-v1",
      state: "added",
      symbol: "NYSE:IBM",
      watchlistName: "Main List",
    });
    expect(fetchRequest).toHaveBeenNthCalledWith(
      2,
      "https://www.tradingview.com/api/v1/symbols_list/custom/123/append/",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        redirect: "error",
        body: '["NYSE:IBM"]',
      }),
    );
  });

  it("removes one exact symbol and confirms absence", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(active(["NASDAQ:AAPL", "NYSE:IBM"]))
      .mockResolvedValueOnce(json(["NASDAQ:AAPL"]))
      .mockResolvedValueOnce(active(["NASDAQ:AAPL"]));

    await expect(
      removeTradingViewWatchlistSymbol(
        fetchRequest,
        { symbol: "NYSE:IBM" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ state: "removed", symbol: "NYSE:IBM" });
    expect(fetchRequest).toHaveBeenNthCalledWith(
      2,
      "https://www.tradingview.com/api/v1/symbols_list/custom/123/remove/",
      expect.objectContaining({ body: '["NYSE:IBM"]' }),
    );
  });

  it("returns deterministic no-ops without issuing a write", async () => {
    const addFetch = vi.fn().mockResolvedValue(active(["NASDAQ:AAPL"]));
    await expect(
      addTradingViewWatchlistSymbol(
        addFetch,
        { symbol: "NASDAQ:AAPL" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ state: "already_present" });
    expect(addFetch).toHaveBeenCalledTimes(1);

    const removeFetch = vi.fn().mockResolvedValue(active(["NASDAQ:AAPL"]));
    await expect(
      removeTradingViewWatchlistSymbol(
        removeFetch,
        { symbol: "NYSE:IBM" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ state: "already_absent" });
    expect(removeFetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed for non-custom lists, changed list identity, and bad postconditions", async () => {
    await expect(
      addTradingViewWatchlistSymbol(
        vi.fn().mockResolvedValue(active([], { type: "colored" })),
        { symbol: "NYSE:IBM" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: "watchlist_action_unavailable" });

    await expect(
      addTradingViewWatchlistSymbol(
        vi
          .fn()
          .mockResolvedValueOnce(active([]))
          .mockResolvedValueOnce(json([]))
          .mockResolvedValueOnce(active(["NYSE:IBM"], { id: 456 })),
        { symbol: "NYSE:IBM" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: "watchlist_action_unavailable" });

    const failedPostcondition = vi
      .fn()
      .mockResolvedValueOnce(active([]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(active([]));
    await expect(
      addTradingViewWatchlistSymbol(
        failedPostcondition,
        { symbol: "NYSE:IBM" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: "watchlist_action_unavailable" });
    expect(failedPostcondition).toHaveBeenCalledTimes(3);
  });

  it("rejects caller-controlled request fields and cancellation before dispatch", async () => {
    const fetchRequest = vi.fn();
    await expect(
      addTradingViewWatchlistSymbol(
        fetchRequest,
        { symbol: "NYSE:IBM", url: "https://example.com" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: "invalid_arguments" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      addTradingViewWatchlistSymbol(
        fetchRequest,
        { symbol: "NYSE:IBM" },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});

function active(
  symbols: readonly string[],
  overrides: Readonly<Record<string, unknown>> = {},
): Response {
  return json({
    id: 123,
    type: "custom",
    name: "Main List",
    symbols,
    ...overrides,
  });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
