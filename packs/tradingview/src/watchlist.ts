import {
  TRADINGVIEW_FINGERPRINT,
  TRADINGVIEW_ORIGIN,
  TradingViewPackError,
  type TradingViewWatchlistMutationInput,
  type TradingViewWatchlistMutationResult,
} from "./model.js";
import {
  isCanonicalTradingViewSymbol,
  validateTradingViewChangeSymbolInput,
} from "./symbol.js";

const ACTIVE_PATH = "/api/v1/symbols_list/active/";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_SYMBOLS = 1_024;
const MAX_WATCHLIST_NAME_LENGTH = 128;
const REQUEST_TIMEOUT_MS = 8_000;
const WATCHLIST_ID = /^[1-9][0-9]{0,19}$/u;

export type TradingViewSessionFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

interface ActiveWatchlist {
  readonly id: string;
  readonly name: string;
  readonly symbols: ReadonlySet<string>;
}

export async function addTradingViewWatchlistSymbol(
  fetchRequest: TradingViewSessionFetch,
  value: unknown,
  signal: AbortSignal,
): Promise<TradingViewWatchlistMutationResult> {
  return mutateWatchlist(fetchRequest, "add", value, signal);
}

export async function removeTradingViewWatchlistSymbol(
  fetchRequest: TradingViewSessionFetch,
  value: unknown,
  signal: AbortSignal,
): Promise<TradingViewWatchlistMutationResult> {
  return mutateWatchlist(fetchRequest, "remove", value, signal);
}

async function mutateWatchlist(
  fetchRequest: TradingViewSessionFetch,
  action: "add" | "remove",
  value: unknown,
  signal: AbortSignal,
): Promise<TradingViewWatchlistMutationResult> {
  abortIfNeeded(signal);
  if (typeof fetchRequest !== "function") unavailable();
  const input = validateWatchlistInput(value);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const before = await readActiveWatchlist(fetchRequest, controller.signal);
    abortIfNeeded(signal);
    const present = before.symbols.has(input.symbol);
    if ((action === "add" && present) || (action === "remove" && !present)) {
      return result(
        action === "add" ? "already_present" : "already_absent",
        input.symbol,
        before.name,
      );
    }

    const operation = action === "add" ? "append" : "remove";
    const path = `/api/v1/symbols_list/custom/${before.id}/${operation}/`;
    const response = await fetchRequest(
      new URL(path, TRADINGVIEW_ORIGIN).href,
      {
        method: "POST",
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify([input.symbol]),
        signal: controller.signal,
      },
    );
    abortIfNeeded(signal);
    if (!response.ok || response.type === "opaqueredirect") unavailable();
    await discardBoundedResponse(response);

    const after = await readActiveWatchlist(fetchRequest, controller.signal);
    abortIfNeeded(signal);
    if (after.id !== before.id || after.name !== before.name) unavailable();
    const confirmed = after.symbols.has(input.symbol);
    if (
      (action === "add" && !confirmed) ||
      (action === "remove" && confirmed)
    ) {
      unavailable();
    }
    return result(
      action === "add" ? "added" : "removed",
      input.symbol,
      after.name,
    );
  } catch (error) {
    abortIfNeeded(signal);
    if (error instanceof TradingViewPackError) throw error;
    unavailable();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

async function readActiveWatchlist(
  fetchRequest: TradingViewSessionFetch,
  signal: AbortSignal,
): Promise<ActiveWatchlist> {
  const response = await fetchRequest(
    new URL(ACTIVE_PATH, TRADINGVIEW_ORIGIN).href,
    {
      method: "GET",
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  if (!response.ok || response.type === "opaqueredirect") unavailable();
  const decoded = await decodeBoundedJson(response);
  if (!isDataObject(decoded)) unavailable();
  const id = dataValue(decoded, "id");
  const type = dataValue(decoded, "type");
  const name = dataValue(decoded, "name");
  const symbols = dataValue(decoded, "symbols");
  const normalizedId =
    typeof id === "number" && Number.isSafeInteger(id) ? String(id) : id;
  if (
    typeof normalizedId !== "string" ||
    !WATCHLIST_ID.test(normalizedId) ||
    type !== "custom" ||
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > MAX_WATCHLIST_NAME_LENGTH ||
    name !== name.trim() ||
    !Array.isArray(symbols) ||
    symbols.length > MAX_SYMBOLS
  ) {
    unavailable();
  }
  const canonical = new Set<string>();
  for (const symbol of symbols) {
    if (typeof symbol !== "string" || symbol.length > 128) unavailable();
    if (symbol.startsWith("###")) continue;
    if (!isCanonicalTradingViewSymbol(symbol)) unavailable();
    canonical.add(symbol);
  }
  return Object.freeze({ id: normalizedId, name, symbols: canonical });
}

async function decodeBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = Number(response.headers.get("content-length"));
  if (
    !contentType.toLowerCase().startsWith("application/json") ||
    (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
  ) {
    unavailable();
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES)
    unavailable();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    unavailable();
  }
}

async function discardBoundedResponse(response: Response): Promise<void> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    unavailable();
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES)
    unavailable();
}

function validateWatchlistInput(
  value: unknown,
): TradingViewWatchlistMutationInput {
  return validateTradingViewChangeSymbolInput(value);
}

function result(
  state: TradingViewWatchlistMutationResult["state"],
  symbol: string,
  watchlistName: string,
): TradingViewWatchlistMutationResult {
  return Object.freeze({
    fingerprint: TRADINGVIEW_FINGERPRINT,
    state,
    symbol,
    watchlistName,
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

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TradingViewPackError("CANCELLED", "cancelled");
  }
}

function unavailable(): never {
  throw new TradingViewPackError(
    "EXECUTION_FAILED",
    "watchlist_action_unavailable",
  );
}
