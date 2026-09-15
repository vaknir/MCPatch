import {
  MAX_CONTROL_LENGTH,
  abortIfNeeded,
  incompatible,
  inspectEnvelope,
  optionalUnique,
  requiredControl,
} from "./extraction-shared.js";
import {
  GOOGLE_FLIGHTS_FINGERPRINT,
  type CurrentSearchResult,
  type GoogleFlightsSemanticSnapshot,
} from "./model.js";

const MAX_PASSENGER_LENGTH = 64;
const PASSENGERS = /^[1-9]\d? passengers?$/;
const TRIP_TYPES = new Map<string, "one_way" | "round_trip">([
  ["Round trip", "round_trip"],
  ["One way", "one_way"],
]);
const CABIN_CLASSES = new Map<
  string,
  "business" | "economy" | "first" | "premium_economy"
>([
  ["Economy", "economy"],
  ["Premium economy", "premium_economy"],
  ["Business", "business"],
  ["First", "first"],
]);

export function extractCurrentSearch(
  snapshot: GoogleFlightsSemanticSnapshot,
  signal: AbortSignal,
): CurrentSearchResult {
  const path = inspectEnvelope(snapshot, signal);
  const origin = requiredControl(snapshot.controls.origin, signal);
  const destination = requiredControl(snapshot.controls.destination, signal);
  const departure = requiredControl(snapshot.controls.departure, signal);
  const returnDate = optionalUnique(
    snapshot.controls.returnDate,
    signal,
    MAX_CONTROL_LENGTH,
  );
  const tripDisplay = requiredControl(snapshot.controls.tripType, signal);
  const cabinDisplay = requiredControl(snapshot.controls.cabinClass, signal);
  const passengers = requiredControl(
    snapshot.controls.passengers,
    signal,
    MAX_PASSENGER_LENGTH,
  );
  const tripType = TRIP_TYPES.get(tripDisplay);
  if (tripType === undefined) incompatible("unsupported_trip_type");
  const cabinClass = CABIN_CLASSES.get(cabinDisplay);
  if (cabinClass === undefined) incompatible("unsupported_cabin_class");
  if (!PASSENGERS.test(passengers)) incompatible("missing_control");
  if (
    path === "search" &&
    (origin === "" ||
      destination === "" ||
      departure === "" ||
      (tripType === "round_trip" && (returnDate ?? "") === ""))
  ) {
    incompatible("missing_control");
  }
  abortIfNeeded(signal);
  return Object.freeze({
    fingerprint: GOOGLE_FLIGHTS_FINGERPRINT,
    path,
    tripType,
    cabinClass,
    passengers,
    origin,
    destination,
    departure,
    ...(returnDate === undefined ? {} : { return: returnDate }),
  });
}
