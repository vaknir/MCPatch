import {
  TRADINGVIEW_FINGERPRINT,
  TRADINGVIEW_SYMBOL_SEARCH_ORIGIN,
  TradingViewPackError,
  type TradingViewAssetType,
  type TradingViewSearchSymbolsInput,
  type TradingViewSearchSymbolsResult,
  type TradingViewSymbolCandidate,
} from "./model.js";
import { isCanonicalTradingViewSymbol } from "./symbol.js";

const SEARCH_PATH = "/symbol_search/v3/";
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 64;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_SOURCE_CANDIDATES = 64;
const REQUEST_TIMEOUT_MS = 8_000;
const EXCHANGE = /^[A-Z0-9_]{1,24}$/u;
const TICKER = /^[A-Z0-9][A-Z0-9._!-]{0,31}$/u;
const COUNTRY = /^[A-Z]{2}$/u;
const CURRENCY = /^[A-Z0-9]{2,8}$/u;
const ASSET_TYPES = new Set<TradingViewAssetType>([
  "bond",
  "crypto",
  "economic",
  "forex",
  "fund",
  "futures",
  "index",
  "stock",
]);

export type TradingViewSearchFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export function validateTradingViewSearchInput(
  value: unknown,
): Required<TradingViewSearchSymbolsInput> {
  if (!isDataObject(value)) invalidArguments();
  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) => typeof key !== "string" || !["limit", "query"].includes(key),
    ) ||
    !keys.includes("query")
  ) {
    invalidArguments();
  }
  const query = dataValue(value, "query");
  const limit = Object.hasOwn(value, "limit")
    ? dataValue(value, "limit")
    : DEFAULT_LIMIT;
  if (
    typeof query !== "string" ||
    query.length < 1 ||
    query.length > MAX_QUERY_LENGTH ||
    query !== query.trim() ||
    hasControlCharacter(query) ||
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > MAX_LIMIT
  ) {
    invalidArguments();
  }
  return Object.freeze({ query, limit: limit as number });
}

export function createTradingViewSearchUrl(value: unknown): string {
  const { query } = validateTradingViewSearchInput(value);
  const url = new URL(SEARCH_PATH, TRADINGVIEW_SYMBOL_SEARCH_ORIGIN);
  url.searchParams.set("text", query);
  url.searchParams.set("hl", "0");
  url.searchParams.set("exchange", "");
  url.searchParams.set("lang", "en");
  url.searchParams.set("search_type", "undefined");
  url.searchParams.set("domain", "production");
  url.searchParams.set("enable_grouping", "false");
  url.searchParams.set("sort_by_country", "US");
  url.searchParams.set("promo", "false");
  return url.href;
}

export async function searchTradingViewSymbols(
  fetchRequest: TradingViewSearchFetch,
  value: unknown,
  signal: AbortSignal,
): Promise<TradingViewSearchSymbolsResult> {
  abortIfNeeded(signal);
  if (typeof fetchRequest !== "function") unavailable();
  const input = validateTradingViewSearchInput(value);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchRequest(createTradingViewSearchUrl(input), {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "default",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    abortIfNeeded(signal);
    if (!response.ok || response.type === "opaqueredirect") unavailable();
    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number(response.headers.get("content-length"));
    if (
      !contentType.toLowerCase().startsWith("application/json") ||
      (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
    ) {
      unavailable();
    }
    const body = await response.text();
    abortIfNeeded(signal);
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      unavailable();
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(body) as unknown;
    } catch {
      unavailable();
    }
    return Object.freeze({
      fingerprint: TRADINGVIEW_FINGERPRINT,
      query: input.query,
      candidates: parseCandidates(decoded, input.limit),
    });
  } catch (error) {
    abortIfNeeded(signal);
    if (error instanceof TradingViewPackError) throw error;
    unavailable();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function parseTradingViewSymbolSearchResponse(
  value: unknown,
  limit: number,
): readonly TradingViewSymbolCandidate[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    invalidArguments();
  }
  return parseCandidates(value, limit);
}

function parseCandidates(
  value: unknown,
  limit: number,
): readonly TradingViewSymbolCandidate[] {
  if (!isDataObject(value)) unavailable();
  const symbols = dataValue(value, "symbols");
  if (!Array.isArray(symbols) || symbols.length > MAX_SOURCE_CANDIDATES) {
    unavailable();
  }
  const candidates: TradingViewSymbolCandidate[] = [];
  const identities = new Set<string>();
  for (const item of symbols) {
    if (candidates.length >= limit) break;
    const candidate = parseCandidate(item);
    if (candidate === undefined || identities.has(candidate.symbol)) continue;
    identities.add(candidate.symbol);
    candidates.push(candidate);
  }
  return Object.freeze(candidates);
}

function parseCandidate(
  value: unknown,
): TradingViewSymbolCandidate | undefined {
  if (!isDataObject(value)) return undefined;
  const ticker = dataValue(value, "symbol");
  const source = dataValue(value, "source2");
  const label = dataValue(value, "description");
  const assetType = dataValue(value, "type");
  if (!isDataObject(source)) return undefined;
  const exchange = dataValue(source, "id");
  if (
    typeof ticker !== "string" ||
    !TICKER.test(ticker) ||
    typeof exchange !== "string" ||
    !EXCHANGE.test(exchange) ||
    typeof label !== "string" ||
    label.length < 1 ||
    label.length > 160 ||
    typeof assetType !== "string" ||
    !ASSET_TYPES.has(assetType as TradingViewAssetType)
  ) {
    return undefined;
  }
  const symbol = `${exchange}:${ticker}`;
  if (!isCanonicalTradingViewSymbol(symbol)) return undefined;
  const country = dataValue(value, "country");
  const currency = dataValue(value, "currency_code");
  return Object.freeze({
    symbol,
    ticker,
    exchange,
    label,
    assetType: assetType as TradingViewAssetType,
    ...(typeof country === "string" && COUNTRY.test(country)
      ? { country }
      : {}),
    ...(typeof currency === "string" && CURRENCY.test(currency)
      ? { currency }
      : {}),
  });
}

function dataValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function isDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function invalidArguments(): never {
  throw new TradingViewPackError("EXECUTION_FAILED", "invalid_arguments");
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TradingViewPackError("CANCELLED", "cancelled");
  }
}

function unavailable(): never {
  throw new TradingViewPackError(
    "EXECUTION_FAILED",
    "symbol_search_unavailable",
  );
}
