import { GoogleFlightsExtractionError } from "./model.js";

export const CONTROL_TEXT_LIMIT = 257;
export const RESULT_TEXT_LIMIT = 1_025;
export const INSIGHT_TEXT_LIMIT = 513;

const MAX_SEMANTIC_CANDIDATES = 64;

export function semanticElements(
  root: Document | Element,
  selector: string,
  signal: AbortSignal,
): Element[] {
  const values: Element[] = [];
  for (const element of root.querySelectorAll(selector)) {
    abortIfNeeded(signal);
    values.push(element);
    if (values.length > MAX_SEMANTIC_CANDIDATES) candidateLimit();
  }
  return values;
}

export function readFormValue(element: Element): string {
  if (element instanceof HTMLInputElement) {
    return boundedDomText(element.value, CONTROL_TEXT_LIMIT);
  }
  const valueText = element.getAttribute("aria-valuetext");
  if (valueText !== null) return boundedDomText(valueText, CONTROL_TEXT_LIMIT);
  return boundedDomText(element.textContent ?? "", CONTROL_TEXT_LIMIT);
}

export function readAccessibleName(element: Element, maximum: number): string {
  return boundedDomText(
    element.getAttribute("aria-label") ?? element.textContent ?? "",
    maximum,
  );
}

export function readElementText(element: Element, maximum: number): string {
  return boundedDomText(element.textContent ?? "", maximum);
}

export function isVisible(element: Element): boolean {
  if (
    element.closest('[hidden],[aria-hidden="true"]') !== null ||
    (element instanceof HTMLElement && element.hidden)
  ) {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  if (view === null) return false;
  const style = view.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
}

export function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GoogleFlightsExtractionError("CANCELLED", "cancelled");
  }
}

function boundedDomText(value: string, maximum: number): string {
  return Array.from(value.replace(/\s+/gu, " ").trim())
    .slice(0, maximum)
    .join("");
}

function candidateLimit(): never {
  throw new GoogleFlightsExtractionError("INCOMPATIBLE", "candidate_limit");
}
