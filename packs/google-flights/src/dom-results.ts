import { collectControlsBySelector } from "./dom-controls.js";
import {
  CONTROL_TEXT_LIMIT,
  INSIGHT_TEXT_LIMIT,
  RESULT_TEXT_LIMIT,
  abortIfNeeded,
  isVisible,
  readAccessibleName,
  readElementText,
  semanticElements,
} from "./dom-shared.js";
import type {
  GoogleFlightsPriceSemantics,
  GoogleFlightsResultsSemantics,
  SemanticFlightCard,
  SemanticTextCandidate,
} from "./model.js";

const RESULT_COUNT =
  /(?:^|\s)([1-9]\d{0,3} results? returned)(?:\.(?=\s|$)|\s|$)/u;

export function collectCards(
  document: Document,
  signal: AbortSignal,
): SemanticFlightCard[] {
  const elements = semanticElements(
    document,
    'a[aria-label^="From "][aria-label*="Total duration"][aria-label*="Select flight"],[role="link"][aria-label^="From "][aria-label*="Total duration"][aria-label*="Select flight"]',
    signal,
  );
  return elements.map((element) => {
    abortIfNeeded(signal);
    const root =
      element.closest('li,[role="listitem"]') ?? element.parentElement;
    const related =
      root === null
        ? []
        : semanticElements(root, "[aria-label]", signal).filter(
            (candidate) => candidate !== element,
          );
    return {
      visible: isVisible(element),
      label: readAccessibleName(element, RESULT_TEXT_LIMIT),
      emissions: relatedCandidates(related, /(?:emissions|CO2e?)/iu),
      caveats: relatedCandidates(
        related,
        /(?:does not include|not included|baggage|carry-on|overhead bin)/iu,
      ),
    };
  });
}

export function collectResultSemantics(
  document: Document,
  cards: SemanticFlightCard[],
  statuses: SemanticTextCandidate[],
  headings: SemanticTextCandidate[],
  signal: AbortSignal,
): GoogleFlightsResultsSemantics | undefined {
  const labelledRegions = collectControlsBySelector(
    document,
    '[aria-label="Search results"]',
    signal,
    (element) => readAccessibleName(element, CONTROL_TEXT_LIMIT),
  );
  const regions =
    labelledRegions.length > 0
      ? labelledRegions
      : headings.filter((candidate) => candidate.text === "Search results");
  const counts = extractStatusMatches(statuses, RESULT_COUNT, signal);
  const loading = exactStatusMatches(
    statuses,
    new Set(["Searching for flights", "Loading results"]),
    signal,
  );
  const empty = exactStatusMatches(
    statuses,
    new Set(["No flights found"]),
    signal,
  );
  const errors = exactStatusMatches(
    statuses,
    new Set([
      "Unable to load flights",
      "Something went wrong",
      "Oops, something went wrong",
    ]),
    signal,
  );
  if (
    regions.length === 0 &&
    cards.length === 0 &&
    counts.length === 0 &&
    loading.length === 0 &&
    empty.length === 0 &&
    errors.length === 0
  ) {
    return undefined;
  }
  return { regions, loading, counts, empty, errors, cards };
}

export function collectPriceSemantics(
  statuses: SemanticTextCandidate[],
  headingElements: readonly Element[],
  signal: AbortSignal,
): GoogleFlightsPriceSemantics | undefined {
  const priceHeadings = headingElements.filter(
    (element) =>
      readElementText(element, CONTROL_TEXT_LIMIT) === "Price insights",
  );
  const headings = priceHeadings.map((element) => ({
    visible: isVisible(element),
    text: "Price insights",
  }));
  const loading = exactStatusMatches(
    statuses,
    new Set(["Loading price insights"]),
    signal,
  );
  const assessments: SemanticTextCandidate[] = [];
  for (const heading of priceHeadings) {
    abortIfNeeded(signal);
    const region = heading.closest("section") ?? heading.parentElement;
    if (region === null) continue;
    const assessment = extractAssessment(
      readElementText(region, INSIGHT_TEXT_LIMIT),
    );
    if (assessment !== undefined) {
      assessments.push({ visible: isVisible(heading), text: assessment });
    }
  }
  if (
    headings.length === 0 &&
    loading.length === 0 &&
    assessments.length === 0
  ) {
    return undefined;
  }
  return { headings, loading, assessments };
}

function extractStatusMatches(
  statuses: SemanticTextCandidate[],
  pattern: RegExp,
  signal: AbortSignal,
): SemanticTextCandidate[] {
  const matches: SemanticTextCandidate[] = [];
  for (const candidate of statuses) {
    abortIfNeeded(signal);
    const value = pattern.exec(candidate.text)?.[1];
    if (value !== undefined) {
      matches.push({ visible: candidate.visible, text: value });
    }
  }
  return matches;
}

function exactStatusMatches(
  statuses: SemanticTextCandidate[],
  allowed: ReadonlySet<string>,
  signal: AbortSignal,
): SemanticTextCandidate[] {
  const matches: SemanticTextCandidate[] = [];
  for (const candidate of statuses) {
    abortIfNeeded(signal);
    for (const value of allowed) {
      if (candidate.text === value || candidate.text.includes(value)) {
        matches.push({ visible: candidate.visible, text: value });
      }
    }
  }
  return matches;
}

function relatedCandidates(
  elements: readonly Element[],
  pattern: RegExp,
): SemanticTextCandidate[] {
  const candidates: SemanticTextCandidate[] = [];
  for (const element of elements) {
    const text = readAccessibleName(element, CONTROL_TEXT_LIMIT);
    if (pattern.test(text)) {
      candidates.push({ visible: isVisible(element), text });
    }
  }
  return candidates;
}

function extractAssessment(value: string): string | undefined {
  const withoutHeading = value.replace(/^Price insights\s*/u, "");
  return /^(Prices? (?:are|is) .+?)(?:\.|$)/u.exec(withoutHeading)?.[1];
}
