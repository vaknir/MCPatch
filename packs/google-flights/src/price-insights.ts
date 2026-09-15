import {
  abortIfNeeded,
  incompatible,
  inspectEnvelope,
  optionalRecognized,
  optionalUnique,
} from "./extraction-shared.js";
import {
  GOOGLE_FLIGHTS_FINGERPRINT,
  type GoogleFlightsSemanticSnapshot,
  type PriceInsightsResult,
} from "./model.js";

const MAX_INSIGHT_LENGTH = 512;
const PRICE_LOADING_STATES = new Set(["Loading price insights"]);

export function extractPriceInsights(
  snapshot: GoogleFlightsSemanticSnapshot,
  signal: AbortSignal,
): PriceInsightsResult {
  const path = inspectEnvelope(snapshot, signal);
  if (path !== "search") incompatible("unsupported_path");
  const semantics = snapshot.priceInsights;
  if (semantics === undefined) return stateResult("unavailable", signal);
  const heading = optionalUnique(semantics.headings, signal);
  const loading = optionalRecognized(
    semantics.loading,
    signal,
    PRICE_LOADING_STATES,
  );
  const assessment = optionalUnique(
    semantics.assessments,
    signal,
    MAX_INSIGHT_LENGTH,
  );
  if (
    loading !== undefined &&
    (heading !== undefined || assessment !== undefined)
  ) {
    incompatible("ambiguous_price_insights");
  }
  if (loading !== undefined) return stateResult("loading", signal);
  if (
    (assessment !== undefined && heading !== "Price insights") ||
    (heading !== undefined && heading !== "Price insights")
  ) {
    incompatible("ambiguous_price_insights");
  }
  if (assessment === undefined) return stateResult("unavailable", signal);
  abortIfNeeded(signal);
  return Object.freeze({
    fingerprint: GOOGLE_FLIGHTS_FINGERPRINT,
    state: "available",
    assessment,
  });
}

function stateResult(
  state: "loading" | "unavailable",
  signal: AbortSignal,
): PriceInsightsResult {
  abortIfNeeded(signal);
  return Object.freeze({ fingerprint: GOOGLE_FLIGHTS_FINGERPRINT, state });
}
