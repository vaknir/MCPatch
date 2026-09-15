import type { JsonObject, JsonValue } from "@mcpatch/sdk/runtime";

import {
  extractCurrentSearch,
  extractPriceInsights,
  extractResults,
} from "./extractor.js";
import {
  FLIGHTS_CURRENT_SEARCH,
  FLIGHTS_PRICE_INSIGHTS,
  FLIGHTS_RESULTS,
  FLIGHTS_SEARCH,
  GOOGLE_FLIGHTS_FINGERPRINT,
  GoogleFlightsExtractionError,
  GoogleFlightsInteractionError,
  type GoogleFlightsSemanticSnapshot,
  type GoogleFlightsToolName,
} from "./model.js";
import {
  GoogleFlightsSearchInputError,
  type GoogleFlightsSearchInput,
  validateGoogleFlightsSearchInput,
} from "./search-input.js";

export type GoogleFlightsAdapterErrorCode =
  "CANCELLED" | "EXECUTION_FAILED" | "TOOL_UNAVAILABLE";

export type GoogleFlightsAdapterErrorReason =
  | GoogleFlightsExtractionError["reason"]
  | GoogleFlightsInteractionError["reason"]
  | "invalid_arguments"
  | "source_failure"
  | "tool_unavailable";

/** Adapter-local error mapped to a page-channel error by the extension wrapper. */
export class GoogleFlightsAdapterError extends Error {
  readonly code: GoogleFlightsAdapterErrorCode;
  readonly reason: GoogleFlightsAdapterErrorReason;

  constructor(
    code: GoogleFlightsAdapterErrorCode,
    reason: GoogleFlightsAdapterErrorReason,
  ) {
    super(`Google Flights adapter failed: ${reason}`);
    this.name = "GoogleFlightsAdapterError";
    this.code = code;
    this.reason = reason;
  }
}

export interface GoogleFlightsSnapshotSource {
  read(
    signal: AbortSignal,
  ): GoogleFlightsSemanticSnapshot | Promise<GoogleFlightsSemanticSnapshot>;
  search?(
    input: GoogleFlightsSearchInput,
    signal: AbortSignal,
  ): void | Promise<void>;
  subscribe?(listener: () => void): () => void;
}

export interface GoogleFlightsPageCapability {
  readonly source: "pack";
  readonly name: GoogleFlightsToolName;
}

export interface GoogleFlightsPageAdapter {
  capabilities(
    signal: AbortSignal,
  ): Promise<readonly GoogleFlightsPageCapability[]>;
  execute(
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<JsonValue>;
  subscribe(listener: () => void): () => void;
}

const CURRENT_CAPABILITY = Object.freeze({
  source: "pack" as const,
  name: FLIGHTS_CURRENT_SEARCH,
});
const SEARCH_ACTION_CAPABILITY = Object.freeze({
  source: "pack" as const,
  name: FLIGHTS_SEARCH,
});
const RESULT_CAPABILITIES = Object.freeze([
  Object.freeze({ source: "pack" as const, name: FLIGHTS_RESULTS }),
  Object.freeze({ source: "pack" as const, name: FLIGHTS_PRICE_INSIGHTS }),
]);

export function createGoogleFlightsPageAdapter(
  source: GoogleFlightsSnapshotSource,
): GoogleFlightsPageAdapter {
  return new SnapshotPageAdapter(source);
}

class SnapshotPageAdapter implements GoogleFlightsPageAdapter {
  readonly #source: GoogleFlightsSnapshotSource;
  #searchState: "accepted" | "failed" | "idle" | "running" = "idle";

  constructor(source: GoogleFlightsSnapshotSource) {
    if (typeof source?.read !== "function") {
      throw new TypeError("Google Flights snapshot source is invalid");
    }
    this.#source = source;
  }

  async capabilities(
    signal: AbortSignal,
  ): Promise<readonly GoogleFlightsPageCapability[]> {
    const snapshot = await this.#read(signal);
    const current = this.#extract(() => extractCurrentSearch(snapshot, signal));
    const capabilities: GoogleFlightsPageCapability[] = [CURRENT_CAPABILITY];
    if (this.#source.search !== undefined && this.#searchState === "idle") {
      capabilities.push(SEARCH_ACTION_CAPABILITY);
    }
    if (current.path === "landing") return Object.freeze(capabilities);
    this.#extract(() => extractResults(snapshot, signal));
    this.#extract(() => extractPriceInsights(snapshot, signal));
    return Object.freeze([...capabilities, ...RESULT_CAPABILITIES]);
  }

  async execute(
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    if (tool === FLIGHTS_SEARCH) {
      return this.#search(args, signal);
    }
    if (!isEmptyDataObject(args)) {
      throw new GoogleFlightsAdapterError(
        "EXECUTION_FAILED",
        "invalid_arguments",
      );
    }
    if (
      tool !== FLIGHTS_CURRENT_SEARCH &&
      tool !== FLIGHTS_RESULTS &&
      tool !== FLIGHTS_PRICE_INSIGHTS
    ) {
      throw new GoogleFlightsAdapterError(
        "TOOL_UNAVAILABLE",
        "tool_unavailable",
      );
    }
    const snapshot = await this.#read(signal);
    const value = this.#extract(() => {
      switch (tool) {
        case FLIGHTS_CURRENT_SEARCH:
          return extractCurrentSearch(snapshot, signal);
        case FLIGHTS_RESULTS:
          return extractResults(snapshot, signal);
        case FLIGHTS_PRICE_INSIGHTS:
          return extractPriceInsights(snapshot, signal);
      }
    });
    return value as unknown as JsonValue;
  }

  async #search(args: JsonObject, signal: AbortSignal): Promise<JsonValue> {
    const search = this.#source.search;
    if (search === undefined || this.#searchState !== "idle") {
      throw new GoogleFlightsAdapterError(
        search === undefined ? "TOOL_UNAVAILABLE" : "EXECUTION_FAILED",
        search === undefined ? "tool_unavailable" : "search_already_started",
      );
    }
    let input: GoogleFlightsSearchInput;
    try {
      input = validateGoogleFlightsSearchInput(args);
    } catch (error) {
      if (error instanceof GoogleFlightsSearchInputError) {
        throw new GoogleFlightsAdapterError(
          "EXECUTION_FAILED",
          "invalid_arguments",
        );
      }
      throw error;
    }
    const snapshot = await this.#read(signal);
    const current = this.#extract(() => extractCurrentSearch(snapshot, signal));
    if (
      current.tripType !== "round_trip" ||
      current.cabinClass !== "economy" ||
      current.passengers !== "1 passenger"
    ) {
      throw new GoogleFlightsAdapterError(
        "EXECUTION_FAILED",
        "unsupported_search_options",
      );
    }
    if (this.#searchState !== "idle") {
      throw new GoogleFlightsAdapterError(
        "EXECUTION_FAILED",
        "search_already_started",
      );
    }
    this.#searchState = "running";
    try {
      await search.call(this.#source, input, signal);
    } catch (error) {
      this.#searchState = "failed";
      if (error instanceof GoogleFlightsInteractionError) {
        throw mapInteractionError(error);
      }
      if (signal.aborted) {
        throw new GoogleFlightsAdapterError("CANCELLED", "cancelled");
      }
      throw new GoogleFlightsAdapterError("EXECUTION_FAILED", "source_failure");
    }
    if (signal.aborted) {
      this.#searchState = "failed";
      throw new GoogleFlightsAdapterError("CANCELLED", "cancelled");
    }
    this.#searchState = "accepted";
    return {
      fingerprint: GOOGLE_FLIGHTS_FINGERPRINT,
      state: "accepted",
    };
  }

  subscribe(listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Google Flights listener is invalid");
    }
    const cleanup = this.#source.subscribe?.(() => {
      if (this.#searchState !== "running") listener();
    });
    if (cleanup !== undefined && typeof cleanup !== "function") {
      throw new TypeError("Google Flights source cleanup is invalid");
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      cleanup?.();
    };
  }

  async #read(signal: AbortSignal): Promise<GoogleFlightsSemanticSnapshot> {
    if (signal.aborted) {
      throw new GoogleFlightsAdapterError("CANCELLED", "cancelled");
    }
    try {
      const snapshot = await this.#source.read(signal);
      if (signal.aborted) {
        throw new GoogleFlightsAdapterError("CANCELLED", "cancelled");
      }
      return snapshot;
    } catch (error) {
      if (error instanceof GoogleFlightsAdapterError) throw error;
      if (error instanceof GoogleFlightsExtractionError) {
        throw mapExtractionError(error);
      }
      if (signal.aborted) {
        throw new GoogleFlightsAdapterError("CANCELLED", "cancelled");
      }
      throw new GoogleFlightsAdapterError("EXECUTION_FAILED", "source_failure");
    }
  }

  #extract<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof GoogleFlightsExtractionError) {
        throw mapExtractionError(error);
      }
      throw new GoogleFlightsAdapterError("EXECUTION_FAILED", "source_failure");
    }
  }
}

function mapExtractionError(
  error: GoogleFlightsExtractionError,
): GoogleFlightsAdapterError {
  return new GoogleFlightsAdapterError(
    error.code === "CANCELLED" ? "CANCELLED" : "EXECUTION_FAILED",
    error.reason,
  );
}

function mapInteractionError(
  error: GoogleFlightsInteractionError,
): GoogleFlightsAdapterError {
  return new GoogleFlightsAdapterError(
    error.code === "CANCELLED" ? "CANCELLED" : "EXECUTION_FAILED",
    error.reason,
  );
}

function isEmptyDataObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).length === 0
  );
}
