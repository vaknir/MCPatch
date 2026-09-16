export const TRADINGVIEW_ORIGIN = "https://www.tradingview.com" as const;
export const TRADINGVIEW_CHART_PATH = "/chart/" as const;
export const TRADINGVIEW_FINGERPRINT =
  "tradingview-chart-semantic-en-v1" as const;

export const TRADINGVIEW_CURRENT_CHART = "tradingview.current_chart" as const;
export const TRADINGVIEW_CURRENT_WATCHLIST =
  "tradingview.current_watchlist" as const;
export const TRADINGVIEW_CHANGE_SYMBOL = "tradingview.change_symbol" as const;

export const TRADINGVIEW_TOOLS = Object.freeze([
  TRADINGVIEW_CURRENT_CHART,
  TRADINGVIEW_CURRENT_WATCHLIST,
  TRADINGVIEW_CHANGE_SYMBOL,
] as const);

export type TradingViewToolName = (typeof TRADINGVIEW_TOOLS)[number];

export interface TradingViewChartSemantics {
  readonly names: readonly string[];
  readonly intervals: readonly string[];
  readonly exchanges: readonly string[];
  readonly canvasLabels: readonly string[];
  readonly ohlc: readonly string[];
  readonly changes: readonly string[];
  readonly volumes: readonly string[];
  readonly currencies: readonly string[];
}

export interface TradingViewWatchlistRowSemantics {
  readonly symbol: string;
  readonly ticker: string;
  readonly values: readonly string[];
  readonly marketStatus?: string;
  readonly active: boolean;
}

/** Minimal bounded semantic input consumed by the pure extractor. */
export interface TradingViewSemanticSnapshot {
  readonly origin: string;
  readonly pathname: string;
  readonly language: string;
  readonly documentTitle: string;
  readonly symbolParameter?: string;
  readonly charts: readonly TradingViewChartSemantics[];
  readonly watchlist?: readonly TradingViewWatchlistRowSemantics[];
}

export interface TradingViewCurrentChartResult {
  readonly fingerprint: typeof TRADINGVIEW_FINGERPRINT;
  readonly symbol: string;
  readonly ticker: string;
  readonly exchange: string;
  readonly name: string;
  readonly interval: string;
  readonly currency?: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly price: number;
  readonly change?: number;
  readonly changePercent?: number;
  readonly volume?: string;
}

export interface TradingViewWatchlistItem {
  readonly symbol: string;
  readonly ticker: string;
  readonly price: number;
  readonly change: number;
  readonly changePercent: number;
  readonly volume?: string;
  readonly marketStatus?: string;
  readonly active: boolean;
}

export interface TradingViewCurrentWatchlistResult {
  readonly fingerprint: typeof TRADINGVIEW_FINGERPRINT;
  readonly items: readonly TradingViewWatchlistItem[];
}

export interface TradingViewChangeSymbolInput {
  readonly symbol: string;
}

export interface TradingViewChangeSymbolResult {
  readonly fingerprint: typeof TRADINGVIEW_FINGERPRINT;
  readonly state: "accepted";
  readonly symbol: string;
}

export type TradingViewErrorCode =
  "CANCELLED" | "EXECUTION_FAILED" | "TOOL_UNAVAILABLE";

export type TradingViewErrorReason =
  | "ambiguous_chart"
  | "ambiguous_value"
  | "cancelled"
  | "incompatible_page"
  | "invalid_arguments"
  | "invalid_symbol"
  | "missing_chart"
  | "missing_value"
  | "navigation_already_started"
  | "navigation_unavailable"
  | "unsupported_locale"
  | "unsupported_origin"
  | "unsupported_path"
  | "watchlist_unavailable";

/** Payload-free pack error normalized by the browser SDK. */
export class TradingViewPackError extends Error {
  readonly code: TradingViewErrorCode;
  readonly reason: TradingViewErrorReason;

  constructor(code: TradingViewErrorCode, reason: TradingViewErrorReason) {
    super(`TradingView pack failed: ${reason}`);
    this.name = "TradingViewPackError";
    this.code = code;
    this.reason = reason;
  }
}
