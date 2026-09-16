import { MCPatch } from "@mcpatch/sdk/browser";
import type { MCPatchDefinition } from "@mcpatch/sdk/runtime";

import {
  createGrantedNavigation,
  createTradingViewDocumentSource,
} from "./document-source.js";
import {
  TRADINGVIEW_ADD_TO_WATCHLIST,
  TRADINGVIEW_CHANGE_SYMBOL,
  TRADINGVIEW_CAPTURE_CHART,
  TRADINGVIEW_CREATE_PRICE_ALERT,
  TRADINGVIEW_CHART_PATH,
  TRADINGVIEW_CURRENT_CHART,
  TRADINGVIEW_CURRENT_WATCHLIST,
  TRADINGVIEW_FINGERPRINT,
  TRADINGVIEW_ORIGIN,
  TRADINGVIEW_PRICE_ALERTS_ORIGIN,
  TRADINGVIEW_REMOVE_FROM_WATCHLIST,
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

const SYMBOL_ACTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  maxProperties: 1,
  required: ["symbol"],
  properties: {
    symbol: { type: "string", minLength: 3, maxLength: 57 },
  },
} as const;

const WATCHLIST_ACTION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fingerprint", "state", "symbol", "watchlistName"],
  properties: {
    fingerprint: { const: TRADINGVIEW_FINGERPRINT },
    state: {
      enum: ["added", "already_absent", "already_present", "removed"],
    },
    symbol: { type: "string" },
    watchlistName: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

const CREATE_ALERT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  maxProperties: 5,
  required: [
    "condition",
    "threshold",
    "frequency",
    "expiresInDays",
    "notification",
  ],
  properties: {
    condition: { enum: ["above", "below", "crosses"] },
    threshold: {
      type: "number",
      minimum: -1_000_000_000_000,
      maximum: 1_000_000_000_000,
    },
    frequency: { enum: ["once", "once_per_bar_close"] },
    expiresInDays: { type: "integer", minimum: 1, maximum: 365 },
    notification: {
      enum: ["mobile_push", "popup_and_mobile_push", "popup_only"],
    },
  },
} as const;

const CREATE_ALERT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "fingerprint",
    "state",
    "alertId",
    "symbol",
    "condition",
    "threshold",
    "frequency",
    "expiresAt",
    "notification",
  ],
  properties: {
    fingerprint: { const: TRADINGVIEW_FINGERPRINT },
    state: { enum: ["confirmed", "created_unconfirmed"] },
    alertId: { type: "string", minLength: 1, maxLength: 64 },
    symbol: { type: "string" },
    condition: { enum: ["above", "below", "crosses"] },
    threshold: { type: "number" },
    frequency: { enum: ["once", "once_per_bar_close"] },
    expiresAt: { type: "string" },
    notification: {
      enum: ["mobile_push", "popup_and_mobile_push", "popup_only"],
    },
  },
} as const;

const mcp = new MCPatch<TradingViewSite>({
  publisher: "tradingview",
  id: "tradingview-web",
  name: "TradingView",
  description:
    "Expose bounded chart and watchlist state plus approved chart, watchlist, and price-alert actions from TradingView.",
  version: "0.5.0",
  digest:
    "sha256:a441a2f868f117514bbf279b4d39aaa3ee6f8a7bfc78e2f5dcf269094c09f473",
  matches: [
    {
      origin: TRADINGVIEW_ORIGIN,
      paths: [{ kind: "prefix", path: TRADINGVIEW_CHART_PATH }],
    },
  ],
  networkPolicy: {
    extensionRequests: {
      origins: [
        TRADINGVIEW_PRICE_ALERTS_ORIGIN,
        TRADINGVIEW_SYMBOL_SEARCH_ORIGIN,
      ],
      methods: ["GET", "POST"],
    },
  },
});

mcp.tool(
  {
    name: TRADINGVIEW_ADD_TO_WATCHLIST,
    description:
      "Add one exact canonical EXCHANGE:TICKER symbol to the current authenticated TradingView watchlist after one-time approval and confirm the resulting state.",
    risk: "action",
    inputSchema: SYMBOL_ACTION_INPUT_SCHEMA,
    outputSchema: WATCHLIST_ACTION_OUTPUT_SCHEMA,
  },
  (input, { site, signal }) => site.addToWatchlist(input, signal),
);

mcp.tool(
  {
    name: TRADINGVIEW_CREATE_PRICE_ALERT,
    description:
      "Create one bounded price alert for the exact current chart symbol using explicit condition, threshold, frequency, expiry, and notification behavior after one-time approval.",
    risk: "action",
    permissions: ["ACTION", "EXTERNAL_NETWORK"],
    inputSchema: CREATE_ALERT_INPUT_SCHEMA,
    outputSchema: CREATE_ALERT_OUTPUT_SCHEMA,
  },
  (input, { site, signal }) => site.createPriceAlert(input, signal),
);

mcp.tool(
  {
    name: TRADINGVIEW_REMOVE_FROM_WATCHLIST,
    description:
      "Remove one exact canonical EXCHANGE:TICKER symbol from the current authenticated TradingView watchlist after one-time approval and confirm the resulting state.",
    risk: "action",
    inputSchema: SYMBOL_ACTION_INPUT_SCHEMA,
    outputSchema: WATCHLIST_ACTION_OUTPUT_SCHEMA,
  },
  (input, { site, signal }) => site.removeFromWatchlist(input, signal),
);

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
    inputSchema: SYMBOL_ACTION_INPUT_SCHEMA,
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
      id: "page-only-create-price-alert",
      tool: TRADINGVIEW_CREATE_PRICE_ALERT,
      input: {
        condition: "above",
        threshold: 250,
        frequency: "once",
        expiresInDays: 30,
        notification: "popup_only",
      },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-add-to-watchlist",
      tool: TRADINGVIEW_ADD_TO_WATCHLIST,
      input: { symbol: "NYSE:IBM" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-remove-from-watchlist",
      tool: TRADINGVIEW_REMOVE_FROM_WATCHLIST,
      input: { symbol: "NYSE:IBM" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
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
  create: (document, services) =>
    createTradingViewSite(
      createTradingViewDocumentSource(
        document,
        createGrantedNavigation(
          document.defaultView?.location.origin ?? TRADINGVIEW_ORIGIN,
          services.navigate,
        ),
      ),
    ),
  discover: ({ site, signal }) => site.capabilities(signal),
  subscribe: (site, listener) => site.subscribe(listener),
});

export const tradingViewPack: MCPatchDefinition =
  tradingViewBrowserPack.definition;
