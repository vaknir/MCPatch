import { describe, expect, it, vi } from "vitest";

import {
  TradingViewPackError,
  createTradingViewSearchUrl,
  parseTradingViewSymbolSearchResponse,
  searchTradingViewSymbols,
  type TradingViewSearchFetch,
  validateTradingViewSearchInput,
} from "../src/index.js";

describe("TradingView symbol discovery", () => {
  it("builds only the fixed first-party search request", () => {
    expect(validateTradingViewSearchInput({ query: "Apple" })).toEqual({
      query: "Apple",
      limit: 8,
    });
    const url = new URL(
      createTradingViewSearchUrl({ query: "BRK.B", limit: 3 }),
    );
    expect(url.origin).toBe("https://symbol-search.tradingview.com");
    expect(url.pathname).toBe("/symbol_search/v3/");
    expect(url.searchParams.get("text")).toBe("BRK.B");
    expect(url.searchParams.get("hl")).toBe("0");
    expect(url.searchParams.get("promo")).toBe("false");
  });

  it("projects bounded canonical candidates and drops malformed entries", () => {
    expect(parseTradingViewSymbolSearchResponse(responseFixture(), 2)).toEqual([
      {
        symbol: "NASDAQ:AAPL",
        ticker: "AAPL",
        exchange: "NASDAQ",
        label: "Apple Inc.",
        assetType: "stock",
        country: "US",
        currency: "USD",
      },
      {
        symbol: "NYSE:IBM",
        ticker: "IBM",
        exchange: "NYSE",
        label: "International Business Machines",
        assetType: "stock",
        country: "US",
        currency: "USD",
      },
    ]);
  });

  it("sends no credentials, captured headers, body, or caller-selected URL", async () => {
    const fetchRequest = vi.fn<TradingViewSearchFetch>(async () =>
      jsonResponse(JSON.stringify(responseFixture())),
    );

    await expect(
      searchTradingViewSymbols(
        fetchRequest,
        { query: "Apple", limit: 1 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      fingerprint: "tradingview-chart-semantic-en-v1",
      query: "Apple",
      candidates: [expect.objectContaining({ symbol: "NASDAQ:AAPL" })],
    });

    expect(fetchRequest).toHaveBeenCalledTimes(1);
    const [url, init] = fetchRequest.mock.calls[0] ?? [];
    expect(url).toMatch(
      /^https:\/\/symbol-search\.tradingview\.com\/symbol_search\/v3\//u,
    );
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    expect(init).not.toHaveProperty("body");
  });

  it("fails closed on invalid input, malformed responses, and cancellation", async () => {
    for (const input of [
      { query: "" },
      { query: " Apple" },
      { query: "Apple", limit: 11 },
      { query: "Apple", url: "https://attacker.example" },
    ]) {
      expect(() => validateTradingViewSearchInput(input)).toThrow(
        TradingViewPackError,
      );
    }
    expect(() =>
      parseTradingViewSymbolSearchResponse(
        { symbols: new Array(65).fill({}) },
        1,
      ),
    ).toThrow(TradingViewPackError);

    await expect(
      searchTradingViewSymbols(
        async () => new Response("not-json", { headers: jsonHeaders() }),
        { query: "Apple" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: "symbol_search_unavailable" });

    const controller = new AbortController();
    controller.abort();
    const fetchRequest = vi.fn<TradingViewSearchFetch>();
    await expect(
      searchTradingViewSymbols(
        fetchRequest,
        { query: "Apple" },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});

function responseFixture() {
  return {
    symbols: [
      {
        symbol: "AAPL",
        source2: { id: "NASDAQ" },
        description: "Apple Inc.",
        type: "stock",
        country: "US",
        currency_code: "USD",
      },
      {
        symbol: "aapl",
        source2: { id: "NASDAQ" },
        description: "unsafe lowercase",
        type: "stock",
      },
      {
        symbol: "IBM",
        source2: { id: "NYSE" },
        description: "International Business Machines",
        type: "stock",
        country: "US",
        currency_code: "USD",
      },
    ],
    symbols_remaining: 20,
  };
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: jsonHeaders() });
}

function jsonHeaders(): HeadersInit {
  return { "content-type": "application/json; charset=utf-8" };
}
