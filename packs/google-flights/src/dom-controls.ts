import {
  CONTROL_TEXT_LIMIT,
  abortIfNeeded,
  isVisible,
  readAccessibleName,
  readFormValue,
  semanticElements,
} from "./dom-shared.js";
import type { GoogleFlightsControls, SemanticTextCandidate } from "./model.js";

const TRIP_VALUES = new Set(["Round trip", "One way", "Multi-city"]);
const CABIN_VALUES = new Set([
  "Economy",
  "Premium economy",
  "Business",
  "First",
]);

export function collectControls(
  document: Document,
  signal: AbortSignal,
): GoogleFlightsControls {
  const comboboxes = collectClassifiedControls(
    document,
    '[role="combobox"]',
    signal,
  );
  return {
    origin: collectControlsBySelector(
      document,
      'input[aria-label="Where from?"],input[placeholder="Where from?"]',
      signal,
    ),
    destination: collectControlsBySelector(
      document,
      'input[aria-label="Where to?"],input[placeholder="Where to?"]',
      signal,
    ),
    departure: collectControlsBySelector(
      document,
      'input[aria-label="Departure"],input[placeholder="Departure"]',
      signal,
    ),
    returnDate: collectControlsBySelector(
      document,
      'input[aria-label="Return"],input[placeholder="Return"]',
      signal,
    ),
    tripType: comboboxes.filter((candidate) => TRIP_VALUES.has(candidate.text)),
    cabinClass: comboboxes.filter((candidate) =>
      CABIN_VALUES.has(candidate.text),
    ),
    passengers: collectControlsBySelector(
      document,
      '[aria-label$=" passenger"],[aria-label$=" passengers"]',
      signal,
      (element) => readAccessibleName(element, CONTROL_TEXT_LIMIT),
    ).filter((candidate) => /^[1-9]\d? passengers?$/u.test(candidate.text)),
  };
}

export function collectControlsBySelector(
  document: Document,
  selector: string,
  signal: AbortSignal,
  read: (element: Element) => string = readFormValue,
): SemanticTextCandidate[] {
  const values: SemanticTextCandidate[] = [];
  for (const element of semanticElements(document, selector, signal)) {
    abortIfNeeded(signal);
    values.push({ visible: isVisible(element), text: read(element) });
  }
  return values;
}

function collectClassifiedControls(
  document: Document,
  selector: string,
  signal: AbortSignal,
): SemanticTextCandidate[] {
  return collectControlsBySelector(document, selector, signal, (element) => {
    const value = readFormValue(element);
    return value === ""
      ? readAccessibleName(element, CONTROL_TEXT_LIMIT)
      : value;
  });
}
