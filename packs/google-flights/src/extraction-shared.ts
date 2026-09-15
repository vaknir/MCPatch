import {
  GOOGLE_FLIGHTS_LANDING_PATH,
  GOOGLE_FLIGHTS_ORIGIN,
  GOOGLE_FLIGHTS_SEARCH_PATH,
  GoogleFlightsExtractionError,
  type GoogleFlightsSemanticSnapshot,
  type SemanticTextCandidate,
} from "./model.js";

export const MAX_CANDIDATES = 64;
export const MAX_CONTROL_LENGTH = 256;

export function inspectEnvelope(
  snapshot: GoogleFlightsSemanticSnapshot,
  signal: AbortSignal,
): "landing" | "search" {
  abortIfNeeded(signal);
  if (snapshot.origin !== GOOGLE_FLIGHTS_ORIGIN) {
    incompatible("unsupported_origin");
  }
  const language = normalize(snapshot.language, 64);
  if (
    language.toLowerCase() !== "en" &&
    !language.toLowerCase().startsWith("en-")
  ) {
    incompatible("unsupported_locale");
  }
  if (snapshot.pathname === GOOGLE_FLIGHTS_LANDING_PATH) return "landing";
  if (snapshot.pathname === GOOGLE_FLIGHTS_SEARCH_PATH) return "search";
  incompatible("unsupported_path");
}

export function requiredControl(
  candidates: SemanticTextCandidate[],
  signal: AbortSignal,
  maximum = MAX_CONTROL_LENGTH,
): string {
  const value = optionalUnique(candidates, signal, maximum);
  if (value === undefined) incompatible("missing_control");
  return value;
}

export function optionalUnique(
  candidates: SemanticTextCandidate[],
  signal: AbortSignal,
  maximum = MAX_CONTROL_LENGTH,
): string | undefined {
  const values = visibleValues(candidates, signal, maximum);
  if (values.length > 1) incompatible("ambiguous_control");
  return values[0];
}

export function optionalRecognized(
  candidates: SemanticTextCandidate[],
  signal: AbortSignal,
  recognized: ReadonlySet<string>,
): string | undefined {
  const value = optionalUnique(candidates, signal);
  if (value !== undefined && !recognized.has(value)) {
    incompatible("ambiguous_result_state");
  }
  return value;
}

export function visibleValues(
  candidates: SemanticTextCandidate[],
  signal: AbortSignal,
  maximum: number,
): string[] {
  if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) {
    incompatible("candidate_limit");
  }
  const values: string[] = [];
  for (const candidate of candidates) {
    abortIfNeeded(signal);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.visible !== "boolean" ||
      typeof candidate.text !== "string"
    ) {
      incompatible("invalid_candidate");
    }
    if (candidate.visible) values.push(normalize(candidate.text, maximum));
  }
  return values;
}

export function normalize(value: string, maximum: number): string {
  if (typeof value !== "string") incompatible("invalid_candidate");
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (Array.from(normalized).length > maximum) {
    incompatible("candidate_limit");
  }
  return normalized;
}

export function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GoogleFlightsExtractionError("CANCELLED", "cancelled");
  }
}

export function incompatible(
  reason: GoogleFlightsExtractionError["reason"],
): never {
  throw new GoogleFlightsExtractionError("INCOMPATIBLE", reason);
}
