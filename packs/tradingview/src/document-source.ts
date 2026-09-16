import {
  TRADINGVIEW_CHART_PATH,
  TradingViewPackError,
  type TradingViewChangeSymbolInput,
  type TradingViewChartSemantics,
  type TradingViewSemanticSnapshot,
  type TradingViewWatchlistRowSemantics,
} from "./model.js";
import type { TradingViewSnapshotSource } from "./site.js";
import { createTradingViewSymbolUrl } from "./symbol.js";
import {
  searchTradingViewSymbols,
  type TradingViewSearchFetch,
} from "./symbol-search.js";

const MAX_CHARTS = 4;
const MAX_CHART_DIVS = 4_096;
const MAX_WATCHLIST_ITEMS = 64;
const OHLC_TEXT = /^[OHLC]\s*[+\-−]?[0-9][0-9,]*(?:\.[0-9]+)?$/u;
const CHANGE_TEXT =
  /^[+\-−]?[0-9][0-9,]*(?:\.[0-9]+)?\s*\([+\-−]?[0-9][0-9,]*(?:\.[0-9]+)?%\)$/u;
const VOLUME_TEXT = /^[0-9][0-9,.]*(?:\s*[KMBT])?$/u;
const EXCHANGE_TEXT = /^[A-Z0-9_]{1,24}$/u;
const MARKET_STATUS =
  /^(?:Market (?:open|closed)|Overnight|Post-market|Pre-market)$/u;

export interface TradingViewNavigation {
  schedule(url: string): void;
}

export function createTradingViewDocumentSource(
  document: Document,
  navigation: TradingViewNavigation = createDocumentNavigation(document),
  fetchRequest: TradingViewSearchFetch = createDocumentFetch(document),
): TradingViewSnapshotSource {
  return new TradingViewDocumentSource(document, navigation, fetchRequest);
}

export function collectTradingViewSemanticSnapshot(
  document: Document,
  signal: AbortSignal,
): TradingViewSemanticSnapshot {
  abortIfNeeded(signal);
  if (document?.nodeType !== 9) {
    throw new TypeError("TradingView document source is invalid");
  }
  const chartElements = boundedElements(
    document,
    '[role="region"][aria-label^="Chart #"]',
    MAX_CHARTS,
  ).filter(isVisible);
  const charts = chartElements.map((element) => collectChart(element, signal));
  const watchlist = collectWatchlist(document, signal);
  const location = document.location;
  const symbolParameter = readSymbolParameter(location.href);
  abortIfNeeded(signal);
  return Object.freeze({
    origin: location.origin,
    pathname: location.pathname,
    language: boundedText(document.documentElement?.lang, 32),
    documentTitle: boundedText(document.title, 160),
    ...(symbolParameter === undefined ? {} : { symbolParameter }),
    charts: Object.freeze(charts),
    ...(watchlist === undefined ? {} : { watchlist }),
  });
}

class TradingViewDocumentSource implements TradingViewSnapshotSource {
  readonly #document: Document;
  readonly #navigation: TradingViewNavigation;
  readonly #fetchRequest: TradingViewSearchFetch;

  constructor(
    document: Document,
    navigation: TradingViewNavigation,
    fetchRequest: TradingViewSearchFetch,
  ) {
    if (
      document?.nodeType !== 9 ||
      typeof navigation?.schedule !== "function" ||
      typeof fetchRequest !== "function"
    ) {
      throw new TypeError("TradingView document source is invalid");
    }
    this.#document = document;
    this.#navigation = navigation;
    this.#fetchRequest = fetchRequest;
  }

  read(signal: AbortSignal): TradingViewSemanticSnapshot {
    return collectTradingViewSemanticSnapshot(this.#document, signal);
  }

  changeSymbol(input: TradingViewChangeSymbolInput, signal: AbortSignal): void {
    abortIfNeeded(signal);
    const url = createTradingViewSymbolUrl(this.#document.location.href, input);
    this.#navigation.schedule(url);
  }

  searchSymbols(input: unknown, signal: AbortSignal) {
    return searchTradingViewSymbols(this.#fetchRequest, input, signal);
  }

  subscribe(listener: () => void): () => void {
    const view = this.#document.defaultView;
    const root = this.#document.documentElement;
    if (view === null || root === null) {
      throw new TypeError("TradingView document cannot be observed");
    }
    let pending: number | undefined;
    const observer = new view.MutationObserver(() => {
      if (pending !== undefined) view.clearTimeout(pending);
      pending = view.setTimeout(() => {
        pending = undefined;
        listener();
      }, 150);
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "aria-label",
        "data-active",
        "data-status",
        "data-symbol-full",
        "data-symbol-short",
        "title",
      ],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (pending !== undefined) view.clearTimeout(pending);
    };
  }
}

function createDocumentFetch(document: Document): TradingViewSearchFetch {
  const view = document.defaultView;
  if (view === null || typeof view?.fetch !== "function") {
    return async () => {
      throw new TypeError("TradingView document fetch is unavailable");
    };
  }
  return (input, init) => view.fetch(input, init);
}

function collectChart(
  root: Element,
  signal: AbortSignal,
): TradingViewChartSemantics {
  const divs = boundedElements(root, "div", MAX_CHART_DIVS);
  const ohlc: string[] = [];
  const changes: string[] = [];
  for (const element of divs) {
    abortIfNeeded(signal);
    if (!isVisible(element)) continue;
    const text = candidateText(element, 64);
    if (text === undefined) continue;
    if (OHLC_TEXT.test(text)) ohlc.push(text);
    if (CHANGE_TEXT.test(text)) changes.push(text);
  }
  return Object.freeze({
    names: textValues(root, '[aria-label="Change symbol"]', 4, 128),
    intervals: textValues(root, '[aria-label="Change interval"]', 4, 32),
    exchanges: Object.freeze(
      boundedElements(root, '[title*=" — "]', 8)
        .filter(isVisible)
        .flatMap((element) => {
          const text = safeText(element, 32);
          const title = boundedAttribute(element, "title", 160);
          return EXCHANGE_TEXT.test(text) && title.startsWith(`${text} — `)
            ? [text]
            : [];
        }),
    ),
    canvasLabels: attributeValues(
      root,
      '[aria-label^="Chart for "]',
      "aria-label",
      8,
      160,
    ),
    ohlc: Object.freeze(ohlc),
    changes: Object.freeze(changes),
    volumes: Object.freeze(
      textValues(root, '[title="Volume"]', 8, 32).filter((value) =>
        VOLUME_TEXT.test(value),
      ),
    ),
    currencies: Object.freeze(
      textValues(root, '[data-name="currency-label-selector"]', 4, 16).filter(
        (value) => /^[A-Z]{3,8}$/u.test(value),
      ),
    ),
  });
}

function collectWatchlist(
  document: Document,
  signal: AbortSignal,
): readonly TradingViewWatchlistRowSemantics[] | undefined {
  const roots = boundedElements(
    document,
    '[data-name="symbol-list-wrap"]',
    2,
  ).filter(isVisible);
  if (roots.length === 0) return undefined;
  if (roots.length !== 1) throw incompatible();
  const root = roots[0];
  if (root === undefined) return undefined;
  const rows = boundedElements(
    root,
    "[data-symbol-full][data-symbol-short]",
    MAX_WATCHLIST_ITEMS,
  ).filter(isVisible);
  return Object.freeze(
    rows.map((row) => {
      abortIfNeeded(signal);
      const values = Array.from(row.children)
        .filter((element) => element.tagName === "SPAN" && isVisible(element))
        .map((element) => safeText(element, 32))
        .filter((value) => value.length > 0)
        .slice(0, 8);
      const statuses = boundedElements(row, "[title]", 32)
        .map((element) => boundedAttribute(element, "title", 64))
        .filter((value) => MARKET_STATUS.test(value));
      const uniqueStatuses = [...new Set(statuses)];
      if (uniqueStatuses.length > 1) throw incompatible();
      const marketStatus = uniqueStatuses[0];
      return Object.freeze({
        symbol: boundedAttribute(row, "data-symbol-full", 64),
        ticker: boundedAttribute(row, "data-symbol-short", 32),
        values: Object.freeze(values),
        ...(marketStatus === undefined ? {} : { marketStatus }),
        active: row.getAttribute("data-active") === "true",
      });
    }),
  );
}

function textValues(
  root: ParentNode,
  selector: string,
  maximum: number,
  textMaximum: number,
): readonly string[] {
  return Object.freeze(
    boundedElements(root, selector, maximum)
      .filter(isVisible)
      .map((element) => safeText(element, textMaximum))
      .filter((value) => value.length > 0),
  );
}

function attributeValues(
  root: ParentNode,
  selector: string,
  attribute: string,
  maximum: number,
  textMaximum: number,
): readonly string[] {
  return Object.freeze(
    boundedElements(root, selector, maximum)
      .filter(isVisible)
      .map((element) => boundedAttribute(element, attribute, textMaximum))
      .filter((value) => value.length > 0),
  );
}

function boundedElements(
  root: ParentNode,
  selector: string,
  maximum: number,
): Element[] {
  const elements = Array.from(root.querySelectorAll(selector));
  if (elements.length > maximum) throw incompatible();
  return elements;
}

function safeText(element: Element, maximum: number): string {
  return boundedText(element.textContent, maximum).replace(/\s+/gu, " ");
}

function candidateText(element: Element, maximum: number): string | undefined {
  const value = element.textContent;
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/gu, " ");
  return text.length <= maximum ? text : undefined;
}

function boundedText(
  value: string | null | undefined,
  maximum: number,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maximum) throw incompatible();
  return text;
}

function boundedAttribute(
  element: Element,
  name: string,
  maximum: number,
): string {
  return boundedText(element.getAttribute(name), maximum);
}

function isVisible(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true") return false;
  const rects = element.getClientRects?.();
  return rects === undefined || rects.length > 0;
}

function readSymbolParameter(href: string): string | undefined {
  try {
    const value = new URL(href).searchParams.get("symbol");
    return value === null || value.length === 0
      ? undefined
      : boundedText(value, 64);
  } catch {
    throw incompatible();
  }
}

function createDocumentNavigation(document: Document): TradingViewNavigation {
  const view = document.defaultView;
  if (view === null) {
    return {
      schedule() {
        throw new TradingViewPackError(
          "TOOL_UNAVAILABLE",
          "navigation_unavailable",
        );
      },
    };
  }
  return {
    schedule(url) {
      if (!url.startsWith(`${view.location.origin}${TRADINGVIEW_CHART_PATH}`)) {
        throw new TradingViewPackError(
          "TOOL_UNAVAILABLE",
          "navigation_unavailable",
        );
      }
      view.setTimeout(() => view.location.assign(url), 0);
    },
  };
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TradingViewPackError("CANCELLED", "cancelled");
  }
}

function incompatible(): TradingViewPackError {
  return new TradingViewPackError("EXECUTION_FAILED", "ambiguous_value");
}
