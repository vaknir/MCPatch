import { MCPatch } from "@mcpatch/sdk/browser";
import type { MCPatchDefinition } from "@mcpatch/sdk/runtime";

import { createTradingViewDocumentSource } from "./document-source.js";
import {
  TRADINGVIEW_CHANGE_SYMBOL,
  TRADINGVIEW_CHART_PATH,
  TRADINGVIEW_CURRENT_CHART,
  TRADINGVIEW_CURRENT_WATCHLIST,
  TRADINGVIEW_FINGERPRINT,
  TRADINGVIEW_ORIGIN,
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
  version: "0.1.0",
  digest:
    "sha256:4fe7409d2222804b2ed7478e1a512f847dab75477c31d5900c35f3f6ab187268",
  matches: [
    {
      origin: TRADINGVIEW_ORIGIN,
      paths: [{ kind: "prefix", path: TRADINGVIEW_CHART_PATH }],
    },
  ],
});

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
