import {
  TRADINGVIEW_CHART_PATH,
  TRADINGVIEW_ORIGIN,
  TradingViewPackError,
  type TradingViewChangeSymbolInput,
} from "./model.js";

export const TRADINGVIEW_SYMBOL_PATTERN =
  "^[A-Z0-9_]{1,24}:[A-Z0-9][A-Z0-9._!\\-]{0,31}$" as const;

const SYMBOL = new RegExp(TRADINGVIEW_SYMBOL_PATTERN, "u");

export function validateTradingViewChangeSymbolInput(
  value: unknown,
): TradingViewChangeSymbolInput {
  if (!isDataObject(value) || Reflect.ownKeys(value).length !== 1) {
    invalidArguments();
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "symbol");
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string" ||
    !SYMBOL.test(descriptor.value)
  ) {
    invalidArguments();
  }
  return Object.freeze({ symbol: descriptor.value });
}

export function createTradingViewSymbolUrl(
  currentUrl: string,
  value: unknown,
): string {
  const input = validateTradingViewChangeSymbolInput(value);
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    throw unavailable("incompatible_page");
  }
  if (
    url.origin !== TRADINGVIEW_ORIGIN ||
    !url.pathname.startsWith(TRADINGVIEW_CHART_PATH)
  ) {
    throw unavailable("incompatible_page");
  }
  url.searchParams.set("symbol", input.symbol);
  return url.href;
}

export function isCanonicalTradingViewSymbol(value: string): boolean {
  return SYMBOL.test(value);
}

function isDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidArguments(): never {
  throw new TradingViewPackError("EXECUTION_FAILED", "invalid_arguments");
}

function unavailable(
  reason: "incompatible_page" | "navigation_unavailable",
): TradingViewPackError {
  return new TradingViewPackError("TOOL_UNAVAILABLE", reason);
}
