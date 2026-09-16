import {
  discoverTradingViewTools,
  extractTradingViewCurrentChart,
  extractTradingViewCurrentWatchlist,
} from "./extractor.js";
import {
  TRADINGVIEW_FINGERPRINT,
  TRADINGVIEW_SEARCH_SYMBOLS,
  TradingViewPackError,
  type TradingViewChangeSymbolInput,
  type TradingViewChangeSymbolResult,
  type TradingViewCurrentChartResult,
  type TradingViewCurrentWatchlistResult,
  type TradingViewSemanticSnapshot,
  type TradingViewSearchSymbolsInput,
  type TradingViewSearchSymbolsResult,
  type TradingViewToolName,
} from "./model.js";
import { validateTradingViewChangeSymbolInput } from "./symbol.js";

export interface TradingViewSnapshotSource {
  read(
    signal: AbortSignal,
  ): TradingViewSemanticSnapshot | Promise<TradingViewSemanticSnapshot>;
  changeSymbol?(
    input: TradingViewChangeSymbolInput,
    signal: AbortSignal,
  ): void | Promise<void>;
  searchSymbols?(
    input: TradingViewSearchSymbolsInput,
    signal: AbortSignal,
  ): Promise<TradingViewSearchSymbolsResult>;
  subscribe?(listener: () => void): () => void;
}

export interface TradingViewSite {
  capabilities(signal: AbortSignal): Promise<readonly TradingViewToolName[]>;
  currentChart(signal: AbortSignal): Promise<TradingViewCurrentChartResult>;
  currentWatchlist(
    signal: AbortSignal,
  ): Promise<TradingViewCurrentWatchlistResult>;
  changeSymbol(
    input: TradingViewChangeSymbolInput,
    signal: AbortSignal,
  ): Promise<TradingViewChangeSymbolResult>;
  searchSymbols(
    input: TradingViewSearchSymbolsInput,
    signal: AbortSignal,
  ): Promise<TradingViewSearchSymbolsResult>;
  subscribe(listener: () => void): () => void;
}

export function createTradingViewSite(
  source: TradingViewSnapshotSource,
): TradingViewSite {
  return new ReviewedTradingViewSite(source);
}

class ReviewedTradingViewSite implements TradingViewSite {
  readonly #source: TradingViewSnapshotSource;
  #candidateCount = 0;
  #candidateSignature: string | undefined;
  #capabilitySignature: string | undefined;
  #navigationState: "accepted" | "failed" | "idle" | "running" = "idle";

  constructor(source: TradingViewSnapshotSource) {
    if (typeof source?.read !== "function") {
      throw new TypeError("TradingView snapshot source is invalid");
    }
    this.#source = source;
  }

  async capabilities(
    signal: AbortSignal,
  ): Promise<readonly TradingViewToolName[]> {
    const snapshot = await this.#read(signal);
    const tools = discoverTradingViewTools(
      snapshot,
      this.#source.changeSymbol !== undefined &&
        this.#navigationState === "idle",
    );
    const availableTools =
      this.#source.searchSymbols === undefined
        ? tools
        : Object.freeze([...tools, TRADINGVIEW_SEARCH_SYMBOLS]);
    this.#capabilitySignature = signature(availableTools);
    this.#candidateSignature = undefined;
    this.#candidateCount = 0;
    return availableTools;
  }

  async currentChart(
    signal: AbortSignal,
  ): Promise<TradingViewCurrentChartResult> {
    return extractTradingViewCurrentChart(await this.#read(signal));
  }

  async currentWatchlist(
    signal: AbortSignal,
  ): Promise<TradingViewCurrentWatchlistResult> {
    return extractTradingViewCurrentWatchlist(await this.#read(signal));
  }

  async changeSymbol(
    value: TradingViewChangeSymbolInput,
    signal: AbortSignal,
  ): Promise<TradingViewChangeSymbolResult> {
    abortIfNeeded(signal);
    const input = validateTradingViewChangeSymbolInput(value);
    const change = this.#source.changeSymbol;
    if (change === undefined || this.#navigationState !== "idle") {
      throw new TradingViewPackError(
        change === undefined ? "TOOL_UNAVAILABLE" : "EXECUTION_FAILED",
        change === undefined
          ? "navigation_unavailable"
          : "navigation_already_started",
      );
    }
    extractTradingViewCurrentChart(await this.#read(signal));
    if (this.#navigationState !== "idle") {
      throw new TradingViewPackError(
        "EXECUTION_FAILED",
        "navigation_already_started",
      );
    }
    this.#navigationState = "running";
    try {
      await change.call(this.#source, input, signal);
    } catch (error) {
      this.#navigationState = "failed";
      if (error instanceof TradingViewPackError) throw error;
      abortIfNeeded(signal);
      throw new TradingViewPackError(
        "EXECUTION_FAILED",
        "navigation_unavailable",
      );
    }
    try {
      abortIfNeeded(signal);
    } catch (error) {
      this.#navigationState = "failed";
      throw error;
    }
    this.#navigationState = "accepted";
    return Object.freeze({
      fingerprint: TRADINGVIEW_FINGERPRINT,
      state: "accepted",
      symbol: input.symbol,
    });
  }

  async searchSymbols(
    input: TradingViewSearchSymbolsInput,
    signal: AbortSignal,
  ): Promise<TradingViewSearchSymbolsResult> {
    abortIfNeeded(signal);
    const search = this.#source.searchSymbols;
    if (search === undefined) {
      throw new TradingViewPackError(
        "TOOL_UNAVAILABLE",
        "symbol_search_unavailable",
      );
    }
    extractTradingViewCurrentChart(await this.#read(signal));
    return search.call(this.#source, input, signal);
  }

  subscribe(listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("TradingView listener is invalid");
    }
    let active = true;
    let controller: AbortController | undefined;
    let queued = false;
    let running = false;
    const refresh = () => {
      if (!active) return;
      queued = true;
      if (running) return;
      running = true;
      void (async () => {
        while (active && queued) {
          queued = false;
          controller = new AbortController();
          const next = await this.#discoverSignature(controller.signal);
          if (active && next !== undefined && this.#admitSignature(next)) {
            try {
              listener();
            } catch {
              // A consumer callback cannot widen or crash the page boundary.
            }
          }
        }
      })().finally(() => {
        running = false;
        if (active && queued) refresh();
      });
    };
    const cleanup = this.#source.subscribe?.(refresh);
    if (cleanup !== undefined && typeof cleanup !== "function") {
      throw new TypeError("TradingView source cleanup is invalid");
    }
    return () => {
      if (!active) return;
      active = false;
      controller?.abort();
      cleanup?.();
    };
  }

  async #discoverSignature(signal: AbortSignal): Promise<string | undefined> {
    try {
      const snapshot = await this.#read(signal);
      return signature(
        appendSearchTool(
          discoverTradingViewTools(
            snapshot,
            this.#source.changeSymbol !== undefined &&
              this.#navigationState === "idle",
          ),
          this.#source.searchSymbols !== undefined,
        ),
      );
    } catch (error) {
      if (error instanceof TradingViewPackError && error.code === "CANCELLED") {
        return undefined;
      }
      return signature([]);
    }
  }

  #admitSignature(next: string): boolean {
    if (next === this.#capabilitySignature) {
      this.#candidateSignature = undefined;
      this.#candidateCount = 0;
      return false;
    }
    if (next === this.#candidateSignature) {
      this.#candidateCount += 1;
    } else {
      this.#candidateSignature = next;
      this.#candidateCount = 1;
    }
    if (this.#candidateCount < 2) return false;
    this.#capabilitySignature = next;
    this.#candidateSignature = undefined;
    this.#candidateCount = 0;
    return true;
  }

  async #read(signal: AbortSignal): Promise<TradingViewSemanticSnapshot> {
    abortIfNeeded(signal);
    try {
      const snapshot = await this.#source.read(signal);
      abortIfNeeded(signal);
      return snapshot;
    } catch (error) {
      if (error instanceof TradingViewPackError) throw error;
      abortIfNeeded(signal);
      throw new TradingViewPackError("EXECUTION_FAILED", "incompatible_page");
    }
  }
}

function appendSearchTool(
  tools: readonly TradingViewToolName[],
  available: boolean,
): readonly TradingViewToolName[] {
  return available
    ? Object.freeze([...tools, TRADINGVIEW_SEARCH_SYMBOLS])
    : tools;
}

function signature(tools: readonly TradingViewToolName[]): string {
  return tools.join("\u0000");
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TradingViewPackError("CANCELLED", "cancelled");
  }
}
