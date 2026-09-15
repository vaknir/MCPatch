export const GOOGLE_FLIGHTS_ORIGIN = "https://www.google.com";
export const GOOGLE_FLIGHTS_LANDING_PATH = "/travel/flights";
export const GOOGLE_FLIGHTS_SEARCH_PATH = "/travel/flights/search";
export const GOOGLE_FLIGHTS_FINGERPRINT =
  "google-flights-rendered-en-v1" as const;

export const FLIGHTS_CURRENT_SEARCH = "flights.current_search" as const;
export const FLIGHTS_RESULTS = "flights.results" as const;
export const FLIGHTS_PRICE_INSIGHTS = "flights.price_insights" as const;
export const GOOGLE_FLIGHTS_TOOLS = Object.freeze([
  FLIGHTS_CURRENT_SEARCH,
  FLIGHTS_RESULTS,
  FLIGHTS_PRICE_INSIGHTS,
] as const);

export type GoogleFlightsToolName = (typeof GOOGLE_FLIGHTS_TOOLS)[number];

export interface SemanticTextCandidate {
  visible: boolean;
  text: string;
}

export interface SemanticFlightCard {
  visible: boolean;
  label: string;
  emissions: SemanticTextCandidate[];
  caveats: SemanticTextCandidate[];
}

export interface GoogleFlightsControls {
  origin: SemanticTextCandidate[];
  destination: SemanticTextCandidate[];
  departure: SemanticTextCandidate[];
  returnDate: SemanticTextCandidate[];
  tripType: SemanticTextCandidate[];
  cabinClass: SemanticTextCandidate[];
  passengers: SemanticTextCandidate[];
}

export interface GoogleFlightsResultsSemantics {
  regions: SemanticTextCandidate[];
  loading: SemanticTextCandidate[];
  counts: SemanticTextCandidate[];
  empty: SemanticTextCandidate[];
  errors: SemanticTextCandidate[];
  cards: SemanticFlightCard[];
}

export interface GoogleFlightsPriceSemantics {
  headings: SemanticTextCandidate[];
  loading: SemanticTextCandidate[];
  assessments: SemanticTextCandidate[];
}

/** Minimal, scrub-safe semantic input consumed by the pure extractor. */
export interface GoogleFlightsSemanticSnapshot {
  origin: string;
  pathname: string;
  language: string;
  controls: GoogleFlightsControls;
  results?: GoogleFlightsResultsSemantics;
  priceInsights?: GoogleFlightsPriceSemantics;
}

export type GoogleFlightsExtractionCode = "CANCELLED" | "INCOMPATIBLE";

export type GoogleFlightsExtractionReason =
  | "ambiguous_control"
  | "ambiguous_price_insights"
  | "ambiguous_result_state"
  | "cancelled"
  | "candidate_limit"
  | "contradictory_result_state"
  | "invalid_candidate"
  | "missing_control"
  | "missing_results_region"
  | "no_valid_result_cards"
  | "unsupported_cabin_class"
  | "unsupported_locale"
  | "unsupported_origin"
  | "unsupported_path"
  | "unsupported_trip_type";

/** Payload-free compatibility error safe to map across the page channel. */
export class GoogleFlightsExtractionError extends Error {
  readonly code: GoogleFlightsExtractionCode;
  readonly reason: GoogleFlightsExtractionReason;

  constructor(
    code: GoogleFlightsExtractionCode,
    reason: GoogleFlightsExtractionReason,
  ) {
    super(`Google Flights extraction failed: ${reason}`);
    this.name = "GoogleFlightsExtractionError";
    this.code = code;
    this.reason = reason;
  }
}

export interface CurrentSearchResult {
  readonly fingerprint: typeof GOOGLE_FLIGHTS_FINGERPRINT;
  readonly path: "landing" | "search";
  readonly tripType: "one_way" | "round_trip";
  readonly cabinClass: "business" | "economy" | "first" | "premium_economy";
  readonly passengers: string;
  readonly origin: string;
  readonly destination: string;
  readonly departure: string;
  readonly return?: string;
}

export interface FlightOffer {
  readonly rank: number;
  readonly summary: string;
  readonly price: string;
  readonly priceScope: "one way total" | "round trip total";
  readonly stops: string;
  readonly carrier: string;
  readonly departure: string;
  readonly arrival: string;
  readonly duration: string;
  readonly emissions?: string;
  readonly caveats: readonly string[];
}

export interface FlightResultsResult {
  readonly fingerprint: typeof GOOGLE_FLIGHTS_FINGERPRINT;
  readonly state: "empty" | "error" | "loading" | "ready";
  readonly reportedCount?: number;
  readonly offers: readonly FlightOffer[];
}

export interface PriceInsightsResult {
  readonly fingerprint: typeof GOOGLE_FLIGHTS_FINGERPRINT;
  readonly state: "available" | "loading" | "unavailable";
  readonly assessment?: string;
}
