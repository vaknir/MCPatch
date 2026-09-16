import {
  TRADINGVIEW_CHANGE_SYMBOL,
  TRADINGVIEW_CHART_PATH,
  TRADINGVIEW_CURRENT_CHART,
  TRADINGVIEW_CURRENT_WATCHLIST,
  TRADINGVIEW_FINGERPRINT,
  TRADINGVIEW_ORIGIN,
  TradingViewPackError,
  type TradingViewCurrentChartResult,
  type TradingViewCurrentWatchlistResult,
  type TradingViewSemanticSnapshot,
  type TradingViewToolName,
  type TradingViewWatchlistItem,
} from "./model.js";
import { isCanonicalTradingViewSymbol } from "./symbol.js";

const QUOTE_FROM_TITLE =
  /^([A-Z0-9][A-Z0-9._!-]{0,31})\s+([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s|$)/u;
const OHLC = /^([OHLC])\s*([+\-−]?[0-9][0-9,]*(?:\.[0-9]+)?)$/u;
const CHANGE =
  /^([+\-−]?[0-9][0-9,]*(?:\.[0-9]+)?)\s*\(([+\-−]?[0-9][0-9,]*(?:\.[0-9]+)?)%\)$/u;
const NUMBER = /^[+\-−]?[0-9][0-9,]*(?:\.[0-9]+)?$/u;

export function discoverTradingViewTools(
  snapshot: TradingViewSemanticSnapshot,
  canNavigate: boolean,
): readonly TradingViewToolName[] {
  const tools: TradingViewToolName[] = [];
  let chartCompatible = false;
  try {
    extractTradingViewCurrentChart(snapshot);
    tools.push(TRADINGVIEW_CURRENT_CHART);
    chartCompatible = true;
  } catch (error) {
    rethrowCancellation(error);
  }
  try {
    extractTradingViewCurrentWatchlist(snapshot);
    tools.push(TRADINGVIEW_CURRENT_WATCHLIST);
  } catch (error) {
    rethrowCancellation(error);
  }
  if (chartCompatible && canNavigate) tools.push(TRADINGVIEW_CHANGE_SYMBOL);
  return Object.freeze(tools);
}

export function extractTradingViewCurrentChart(
  snapshot: TradingViewSemanticSnapshot,
): TradingViewCurrentChartResult {
  inspectEnvelope(snapshot);
  if (snapshot.charts.length !== 1) {
    throw incompatible(
      snapshot.charts.length === 0 ? "missing_chart" : "ambiguous_chart",
    );
  }
  const chart = snapshot.charts[0];
  if (chart === undefined) throw incompatible("missing_chart");

  const quote = quoteFromTitle(snapshot.documentTitle);
  const ticker = quote.ticker;
  const exchange = one(chart.exchanges, "missing_value");
  validateCanvasTicker(chart.canvasLabels, ticker);
  const symbol = resolveSymbol(snapshot, exchange, ticker);
  const ohlc = parseOhlc(chart.ohlc);
  const change = optionalChange(chart.changes);
  const currency = optionalOne(chart.currencies);
  const volume = optionalOne(chart.volumes);

  return Object.freeze({
    fingerprint: TRADINGVIEW_FINGERPRINT,
    symbol,
    ticker,
    exchange,
    name: one(chart.names, "missing_value"),
    interval: one(chart.intervals, "missing_value"),
    ...(currency === undefined ? {} : { currency }),
    open: ohlc.O,
    high: ohlc.H,
    low: ohlc.L,
    close: ohlc.C,
    price: quote.price,
    ...(change === undefined
      ? {}
      : { change: change.value, changePercent: change.percent }),
    ...(volume === undefined ? {} : { volume }),
  });
}

export function extractTradingViewCurrentWatchlist(
  snapshot: TradingViewSemanticSnapshot,
): TradingViewCurrentWatchlistResult {
  inspectEnvelope(snapshot);
  const rows = snapshot.watchlist;
  if (rows === undefined || rows.length === 0) {
    throw incompatible("watchlist_unavailable");
  }
  const symbols = new Set<string>();
  const items: TradingViewWatchlistItem[] = [];
  for (const row of rows) {
    if (
      !isCanonicalTradingViewSymbol(row.symbol) ||
      !row.symbol.endsWith(`:${row.ticker}`) ||
      symbols.has(row.symbol) ||
      row.values.length < 3
    ) {
      throw incompatible("ambiguous_value");
    }
    symbols.add(row.symbol);
    const volume = row.values[3];
    items.push(
      Object.freeze({
        symbol: row.symbol,
        ticker: row.ticker,
        price: parseNumber(row.values[0]),
        change: parseNumber(row.values[1]),
        changePercent: parsePercent(row.values[2]),
        ...(volume === undefined ? {} : { volume }),
        ...(row.marketStatus === undefined
          ? {}
          : { marketStatus: row.marketStatus }),
        active: row.active,
      }),
    );
  }
  return Object.freeze({
    fingerprint: TRADINGVIEW_FINGERPRINT,
    items: Object.freeze(items),
  });
}

export function inspectEnvelope(snapshot: TradingViewSemanticSnapshot): void {
  if (snapshot.origin !== TRADINGVIEW_ORIGIN) {
    throw incompatible("unsupported_origin");
  }
  if (!snapshot.pathname.startsWith(TRADINGVIEW_CHART_PATH)) {
    throw incompatible("unsupported_path");
  }
  if (!/^en(?:-|$)/iu.test(snapshot.language)) {
    throw incompatible("unsupported_locale");
  }
}

function resolveSymbol(
  snapshot: TradingViewSemanticSnapshot,
  exchange: string,
  ticker: string,
): string {
  const candidates: string[] = [];
  if (snapshot.symbolParameter !== undefined) {
    if (
      !isCanonicalTradingViewSymbol(snapshot.symbolParameter) ||
      snapshot.symbolParameter !== `${exchange}:${ticker}`
    ) {
      throw incompatible("invalid_symbol");
    }
    candidates.push(snapshot.symbolParameter);
  }
  const active = (snapshot.watchlist ?? [])
    .filter((row) => row.active)
    .map((row) => row.symbol);
  if (active.some((symbol) => symbol !== `${exchange}:${ticker}`)) {
    throw incompatible("ambiguous_value");
  }
  candidates.push(...active);
  const unique = [...new Set(candidates)];
  if (unique.length > 1) throw incompatible("ambiguous_value");
  const symbol = unique[0] ?? `${exchange}:${ticker}`;
  if (!isCanonicalTradingViewSymbol(symbol)) {
    throw incompatible("invalid_symbol");
  }
  return symbol;
}

function validateCanvasTicker(labels: readonly string[], ticker: string): void {
  const unique = [...new Set(labels)];
  if (unique.length !== 1) {
    throw incompatible(
      unique.length === 0 ? "missing_value" : "ambiguous_value",
    );
  }
  const label = unique[0] as string;
  const match = /^Chart for [A-Z0-9_]+:([^,]+),\s/u.exec(label);
  if (match?.[1] !== ticker) throw incompatible("invalid_symbol");
}

function quoteFromTitle(value: string): { price: number; ticker: string } {
  const match = QUOTE_FROM_TITLE.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw incompatible("missing_value");
  }
  return { ticker: match[1], price: parseNumber(match[2]) };
}

function parseOhlc(
  values: readonly string[],
): Record<"C" | "H" | "L" | "O", number> {
  const fields = new Map<string, Set<number>>();
  for (const value of values) {
    const match = OHLC.exec(value);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const entries = fields.get(match[1]) ?? new Set<number>();
    entries.add(parseNumber(match[2]));
    fields.set(match[1], entries);
  }
  for (const field of ["O", "H", "L", "C"] as const) {
    if (fields.get(field)?.size !== 1) {
      throw incompatible(
        fields.has(field) ? "ambiguous_value" : "missing_value",
      );
    }
  }
  return {
    O: [...(fields.get("O") as Set<number>)][0] as number,
    H: [...(fields.get("H") as Set<number>)][0] as number,
    L: [...(fields.get("L") as Set<number>)][0] as number,
    C: [...(fields.get("C") as Set<number>)][0] as number,
  };
}

function optionalChange(
  values: readonly string[],
): { value: number; percent: number } | undefined {
  const parsed = values.flatMap((value) => {
    const match = CHANGE.exec(value);
    return match?.[1] === undefined || match[2] === undefined
      ? []
      : [{ value: parseNumber(match[1]), percent: parseNumber(match[2]) }];
  });
  const unique = new Map(
    parsed.map((value) => [`${value.value}:${value.percent}`, value]),
  );
  if (unique.size > 1) throw incompatible("ambiguous_value");
  return unique.values().next().value as
    { value: number; percent: number } | undefined;
}

function parseNumber(value: string | undefined): number {
  if (value === undefined || !NUMBER.test(value)) {
    throw incompatible("missing_value");
  }
  const parsed = Number(value.replace(/,/gu, "").replace(/−/gu, "-"));
  if (!Number.isFinite(parsed)) throw incompatible("missing_value");
  return parsed;
}

function parsePercent(value: string | undefined): number {
  return parseNumber(value?.endsWith("%") ? value.slice(0, -1) : undefined);
}

function one(values: readonly string[], reason: "missing_value"): string {
  const unique = [...new Set(values)];
  if (unique.length !== 1) {
    throw incompatible(unique.length === 0 ? reason : "ambiguous_value");
  }
  return unique[0] as string;
}

function optionalOne(values: readonly string[]): string | undefined {
  const unique = [...new Set(values)];
  if (unique.length > 1) throw incompatible("ambiguous_value");
  return unique[0];
}

function rethrowCancellation(error: unknown): void {
  if (error instanceof TradingViewPackError && error.code === "CANCELLED") {
    throw error;
  }
}

function incompatible(
  reason:
    | "ambiguous_chart"
    | "ambiguous_value"
    | "invalid_symbol"
    | "missing_chart"
    | "missing_value"
    | "unsupported_locale"
    | "unsupported_origin"
    | "unsupported_path"
    | "watchlist_unavailable",
): TradingViewPackError {
  return new TradingViewPackError("TOOL_UNAVAILABLE", reason);
}
