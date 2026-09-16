import { MCPatch } from "@mcpatch/sdk/browser";
import type { MCPatchDefinition } from "@mcpatch/sdk/runtime";

import { createTradingViewDocumentSource } from "./document-source.js";
import {
  TRADINGVIEW_CHANGE_SYMBOL,
  TRADINGVIEW_CAPTURE_CHART,
  TRADINGVIEW_CHART_PATH,
  TRADINGVIEW_CURRENT_CHART,
  TRADINGVIEW_CURRENT_WATCHLIST,
  TRADINGVIEW_FINGERPRINT,
  TRADINGVIEW_ORIGIN,
  TRADINGVIEW_SEARCH_SYMBOLS,
  TRADINGVIEW_SYMBOL_SEARCH_ORIGIN,
} from "./model.js";
import { createTradingViewSite, type TradingViewSite } from "./site.js";

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
  properties: {},
} as const;

const mcp = new MCPatch<TradingViewSite>({
  publisher: "tradingview",
  id: "tradingview-web",
  name: "TradingView",
  description:
    "Expose bounded chart and watchlist state plus approved chart navigation from TradingView.",
  version: "0.3.0",
  digest:
    "sha256:0302771a5570c24f8d5abb3458b311b753e357d8937a9126d1759ac4ff7497be",
  matches: [
    {
      origin: TRADINGVIEW_ORIGIN,
      paths: [{ kind: "prefix", path: TRADINGVIEW_CHART_PATH }],
    },
  ],
  networkPolicy: {
    extensionRequests: {
      origins: [TRADINGVIEW_SYMBOL_SEARCH_ORIGIN],
      methods: ["GET"],
    },
  },
});

mcp.tool(
  {
    name: TRADINGVIEW_CAPTURE_CHART,
    description:
      "Capture only the active reviewed TradingView chart canvases as one bounded WebP MCP image, excluding browser chrome and unrelated page regions.",
    risk: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "symbol", "mimeType", "width", "height"],
      properties: {
        fingerprint: { const: TRADINGVIEW_FINGERPRINT },
        symbol: { type: "string" },
        mimeType: { const: "image/webp" },
        width: { type: "integer", minimum: 1, maximum: 2048 },
        height: { type: "integer", minimum: 1, maximum: 2048 },
      },
    },
  },
  (_input, { site, signal }) => site.captureChart(signal),
);

mcp.tool(
  {
    name: TRADINGVIEW_SEARCH_SYMBOLS,
    description:
      "Resolve a bounded company or ticker query to canonical exchange-qualified TradingView symbols without exposing cookies or raw network responses.",
    risk: "read",
    permissions: ["READ", "EXTERNAL_NETWORK"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      maxProperties: 2,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 64 },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "query", "candidates"],
      properties: {
        fingerprint: { const: TRADINGVIEW_FINGERPRINT },
        query: { type: "string" },
        candidates: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["symbol", "ticker", "exchange", "label", "assetType"],
            properties: {
              symbol: { type: "string" },
              ticker: { type: "string" },
              exchange: { type: "string" },
              label: { type: "string" },
              assetType: {
                enum: [
                  "bond",
                  "crypto",
                  "economic",
                  "forex",
                  "fund",
                  "futures",
                  "index",
                  "stock",
                ],
              },
              country: { type: "string" },
              currency: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.searchSymbols(input, signal),
);

mcp.tool(
  {
    name: TRADINGVIEW_CURRENT_CHART,
    description:
      "Read the exact active TradingView chart identity, interval, visible candle OHLC, current displayed price, change, currency, and volume.",
    risk: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "fingerprint",
        "symbol",
        "ticker",
        "exchange",
        "name",
        "interval",
        "open",
        "high",
        "low",
        "close",
        "price",
      ],
      properties: {
        fingerprint: { const: TRADINGVIEW_FINGERPRINT },
        symbol: { type: "string" },
        ticker: { type: "string" },
        exchange: { type: "string" },
        name: { type: "string" },
        interval: { type: "string" },
        currency: { type: "string" },
        open: { type: "number" },
        high: { type: "number" },
        low: { type: "number" },
        close: { type: "number" },
        price: { type: "number" },
        change: { type: "number" },
        changePercent: { type: "number" },
        volume: { type: "string" },
      },
    },
  },
  (_input, { site, signal }) => site.currentChart(signal),
);

mcp.tool(
  {
    name: TRADINGVIEW_CURRENT_WATCHLIST,
    description:
      "Read at most 64 currently visible TradingView watchlist rows with canonical symbols and bounded quote fields.",
    risk: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "items"],
      properties: {
        fingerprint: { const: TRADINGVIEW_FINGERPRINT },
        items: {
          type: "array",
          maxItems: 64,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "symbol",
              "ticker",
              "price",
              "change",
              "changePercent",
              "active",
            ],
            properties: {
              symbol: { type: "string" },
              ticker: { type: "string" },
              price: { type: "number" },
              change: { type: "number" },
              changePercent: { type: "number" },
              volume: { type: "string" },
              marketStatus: { type: "string" },
              active: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  (_input, { site, signal }) => site.currentWatchlist(signal),
);

mcp.tool(
  {
    name: TRADINGVIEW_CHANGE_SYMBOL,
    description:
      "Change the active TradingView chart to one exact canonical EXCHANGE:TICKER symbol after one-time approval.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 1,
      required: ["symbol"],
      properties: {
        symbol: {
          type: "string",
          minLength: 3,
          maxLength: 57,
        },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "symbol"],
      properties: {
        fingerprint: { const: TRADINGVIEW_FINGERPRINT },
        state: { const: "accepted" },
        symbol: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.changeSymbol(input, signal),
);

export const tradingViewBrowserPack = mcp.build({
  fixtures: [
    {
      id: "page-only-capture-chart",
      tool: TRADINGVIEW_CAPTURE_CHART,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-current-chart",
      tool: TRADINGVIEW_CURRENT_CHART,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-current-watchlist",
      tool: TRADINGVIEW_CURRENT_WATCHLIST,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-search-symbols",
      tool: TRADINGVIEW_SEARCH_SYMBOLS,
      input: { query: "Apple", limit: 5 },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-change-symbol",
      tool: TRADINGVIEW_CHANGE_SYMBOL,
      input: { symbol: "NASDAQ:AAPL" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
  ],
  create: (document) =>
    createTradingViewSite(createTradingViewDocumentSource(document)),
  discover: ({ site, signal }) => site.capabilities(signal),
  subscribe: (site, listener) => site.subscribe(listener),
});

export const tradingViewPack: MCPatchDefinition =
  tradingViewBrowserPack.definition;
