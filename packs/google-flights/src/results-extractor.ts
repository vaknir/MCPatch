import {
  MAX_CANDIDATES,
  abortIfNeeded,
  incompatible,
  inspectEnvelope,
  normalize,
  optionalRecognized,
  optionalUnique,
  visibleValues,
} from "./extraction-shared.js";
import {
  GOOGLE_FLIGHTS_FINGERPRINT,
  type FlightOffer,
  type FlightResultsResult,
  type GoogleFlightsSemanticSnapshot,
  type SemanticFlightCard,
  type SemanticTextCandidate,
} from "./model.js";

const MAX_OFFERS = 20;
const MAX_CAVEATS = 4;
const MAX_SUMMARY_LENGTH = 1_024;
const MAX_COMPONENT_LENGTH = 256;
const RESULT_COUNT = /^(?<count>[1-9]\d{0,3}) results? returned$/;
const CARD =
  /^From (?<price>.+?) (?<scope>round trip total|one way total)\.\s*(?<caveats>.*?)(?<stops>Nonstop|[1-9]\d? stops?) flight with (?<carrier>.+?)\. (?<departure>Leaves .+?) and (?<arrival>arrives at .+?)\. Total duration (?<duration>.+?)\. Select flight$/;
const LOADING_STATES = new Set(["Searching for flights", "Loading results"]);
const EMPTY_STATES = new Set(["No flights found"]);
const ERROR_STATES = new Set([
  "Unable to load flights",
  "Something went wrong",
  "Oops, something went wrong",
]);

export function extractResults(
  snapshot: GoogleFlightsSemanticSnapshot,
  signal: AbortSignal,
): FlightResultsResult {
  const path = inspectEnvelope(snapshot, signal);
  if (path !== "search") incompatible("unsupported_path");
  const semantics = snapshot.results;
  if (semantics === undefined) incompatible("missing_results_region");
  const region = optionalUnique(semantics.regions, signal);
  if (region !== "Search results") incompatible("missing_results_region");

  const loading = optionalRecognized(semantics.loading, signal, LOADING_STATES);
  const countText = optionalUnique(semantics.counts, signal);
  const empty = optionalRecognized(semantics.empty, signal, EMPTY_STATES);
  const error = optionalRecognized(semantics.errors, signal, ERROR_STATES);
  const present = [loading, countText, empty, error].filter(
    (value) => value !== undefined,
  );
  if (present.length === 0) incompatible("ambiguous_result_state");
  if (present.length > 1) incompatible("contradictory_result_state");
  if (loading !== undefined) return stateResult("loading", signal);
  if (empty !== undefined) return stateResult("empty", signal);
  if (error !== undefined) return stateResult("error", signal);

  const match = RESULT_COUNT.exec(countText ?? "");
  const count = Number(match?.groups?.count);
  if (!Number.isSafeInteger(count) || count < 1) {
    incompatible("ambiguous_result_state");
  }
  const offers = collectOffers(semantics.cards, signal);
  if (offers.length === 0) incompatible("no_valid_result_cards");
  abortIfNeeded(signal);
  return Object.freeze({
    fingerprint: GOOGLE_FLIGHTS_FINGERPRINT,
    state: "ready",
    reportedCount: count,
    offers,
  });
}

function collectOffers(
  cards: SemanticFlightCard[],
  signal: AbortSignal,
): readonly FlightOffer[] {
  if (!Array.isArray(cards) || cards.length > MAX_CANDIDATES) {
    incompatible("candidate_limit");
  }
  const offers: FlightOffer[] = [];
  for (const card of cards) {
    abortIfNeeded(signal);
    if (!validCardShape(card)) incompatible("invalid_candidate");
    if (!card.visible) continue;
    const offer = parseCard(card, offers.length + 1, signal);
    if (offer !== undefined) offers.push(offer);
    if (offers.length === MAX_OFFERS) break;
  }
  return Object.freeze(offers);
}

function parseCard(
  card: SemanticFlightCard,
  rank: number,
  signal: AbortSignal,
): FlightOffer | undefined {
  let summary: string;
  try {
    summary = normalize(card.label, MAX_SUMMARY_LENGTH);
  } catch {
    return undefined;
  }
  const groups = CARD.exec(summary)?.groups;
  if (groups === undefined) return undefined;
  const price = boundedGroup(groups.price);
  const scope = groups.scope;
  const stops = boundedGroup(groups.stops);
  const carrier = boundedGroup(groups.carrier);
  const departure = boundedGroup(groups.departure);
  const arrivalText = boundedGroup(groups.arrival);
  const duration = boundedGroup(groups.duration);
  if (
    price === undefined ||
    (scope !== "round trip total" && scope !== "one way total") ||
    stops === undefined ||
    carrier === undefined ||
    departure === undefined ||
    arrivalText === undefined ||
    duration === undefined
  ) {
    return undefined;
  }
  const emissions = optionalUnique(
    card.emissions,
    signal,
    MAX_COMPONENT_LENGTH,
  );
  const caveats = collectCaveats(groups.caveats ?? "", card.caveats, signal);
  abortIfNeeded(signal);
  return Object.freeze({
    rank,
    summary,
    price,
    priceScope: scope,
    stops,
    carrier,
    departure,
    arrival: `A${arrivalText.slice(1)}`,
    duration,
    ...(emissions === undefined ? {} : { emissions }),
    caveats,
  });
}

function collectCaveats(
  embedded: string,
  candidates: SemanticTextCandidate[],
  signal: AbortSignal,
): readonly string[] {
  const values: string[] = [];
  for (const part of normalize(embedded, MAX_SUMMARY_LENGTH).split(/\.\s*/u)) {
    abortIfNeeded(signal);
    const value = normalize(part, MAX_COMPONENT_LENGTH);
    if (value !== "" && !values.includes(value)) values.push(value);
    if (values.length === MAX_CAVEATS) return Object.freeze(values);
  }
  for (const value of visibleValues(candidates, signal, MAX_COMPONENT_LENGTH)) {
    if (!values.includes(value)) values.push(value);
    if (values.length === MAX_CAVEATS) break;
  }
  return Object.freeze(values);
}

function boundedGroup(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const normalized = normalize(value, MAX_COMPONENT_LENGTH);
    return normalized === "" ? undefined : normalized;
  } catch {
    return undefined;
  }
}

function validCardShape(card: SemanticFlightCard): boolean {
  return (
    typeof card === "object" &&
    card !== null &&
    typeof card.visible === "boolean" &&
    typeof card.label === "string" &&
    Array.isArray(card.emissions) &&
    Array.isArray(card.caveats)
  );
}

function stateResult(
  state: "empty" | "error" | "loading",
  signal: AbortSignal,
): FlightResultsResult {
  abortIfNeeded(signal);
  return Object.freeze({
    fingerprint: GOOGLE_FLIGHTS_FINGERPRINT,
    state,
    offers: Object.freeze([]),
  });
}
