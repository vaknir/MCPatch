import {
  abortInteraction,
  performGoogleFlightsSearch,
  type AirportField,
  type DateField,
  type GoogleFlightsSearchControls,
} from "./search-action.js";
import { GoogleFlightsInteractionError } from "./model.js";
import type { GoogleFlightsSearchInput } from "./search-input.js";
import {
  CONTROL_TEXT_LIMIT,
  isVisible,
  readAccessibleName,
} from "./dom-shared.js";

const AIRPORT_SELECTORS = Object.freeze({
  origin: 'input[aria-label="Where from?"],input[placeholder="Where from?"]',
  destination: 'input[aria-label="Where to?"],input[placeholder="Where to?"]',
});
const DATE_SELECTORS = Object.freeze({
  outboundDate: 'input[aria-label="Departure"],input[placeholder="Departure"]',
  returnDate: 'input[aria-label="Return"],input[placeholder="Return"]',
});
const SEARCH_BUTTON_SELECTOR =
  'button[aria-label="Search"],[role="button"][aria-label="Search"],button[type="submit"]';
const AIRPORT_OPTION_SELECTOR = '[role="option"]';
const MAX_ACTION_CANDIDATES = 64;
const WAIT_TIMEOUT_MS = 4_000;
const WAIT_INTERVAL_MS = 50;

export async function submitGoogleFlightsDocumentSearch(
  document: Document,
  input: GoogleFlightsSearchInput,
  signal: AbortSignal,
): Promise<void> {
  await performGoogleFlightsSearch(
    new GoogleFlightsDocumentSearchControls(document),
    input,
    signal,
  );
}

export function googleFlightsDateLabels(isoDate: string): readonly string[] {
  const [yearText, monthText, dayText] = isoDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  const full = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  const short = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  return Object.freeze([full, short]);
}

class GoogleFlightsDocumentSearchControls implements GoogleFlightsSearchControls {
  readonly #document: Document;
  readonly #view: Window & typeof globalThis;

  constructor(document: Document) {
    const view = document.defaultView;
    if (document.nodeType !== 9 || view === null) {
      throw new GoogleFlightsInteractionError(
        "INCOMPATIBLE",
        "missing_search_control",
      );
    }
    this.#document = document;
    this.#view = view;
  }

  async selectAirport(
    field: AirportField,
    airportCode: string,
    signal: AbortSignal,
  ): Promise<void> {
    abortInteraction(signal);
    const input = this.#requiredInput(AIRPORT_SELECTORS[field], signal);
    input.focus();
    input.click();
    setInputValue(this.#view, input, airportCode);
    const codePattern = new RegExp(
      `(?:^|[^A-Z])${airportCode}(?:[^A-Z]|$)`,
      "u",
    );
    const option = await this.#waitForUnique(
      AIRPORT_OPTION_SELECTOR,
      (element) =>
        codePattern.test(readAccessibleName(element, CONTROL_TEXT_LIMIT)),
      signal,
    );
    requiredClickable(option).click();
  }

  async selectDate(
    field: DateField,
    isoDate: string,
    signal: AbortSignal,
  ): Promise<void> {
    abortInteraction(signal);
    this.#requiredInput(DATE_SELECTORS[field], signal).click();
    const labels = googleFlightsDateLabels(isoDate);
    const selector = labels.map((label) => `[aria-label="${label}"]`).join(",");
    const target = await this.#waitForUnique(selector, () => true, signal);
    requiredClickable(target).click();
  }

  scheduleSubmit(signal: AbortSignal): void {
    abortInteraction(signal);
    const button = this.#requiredUnique(
      SEARCH_BUTTON_SELECTOR,
      (element) => readAccessibleName(element, CONTROL_TEXT_LIMIT) === "Search",
      signal,
    );
    const clickable = requiredClickable(button);
    this.#view.setTimeout(() => clickable.click(), 0);
  }

  #requiredInput(selector: string, signal: AbortSignal): HTMLInputElement {
    const element = this.#requiredUnique(selector, () => true, signal);
    if (!(element instanceof this.#view.HTMLInputElement)) {
      throw new GoogleFlightsInteractionError(
        "INCOMPATIBLE",
        "missing_search_control",
      );
    }
    return element;
  }

  #requiredUnique(
    selector: string,
    predicate: (element: Element) => boolean,
    signal: AbortSignal,
  ): Element {
    abortInteraction(signal);
    const matches = this.#visibleMatches(selector, predicate);
    if (matches.length === 1) return matches[0] as Element;
    throw new GoogleFlightsInteractionError(
      "INCOMPATIBLE",
      matches.length === 0
        ? "missing_search_control"
        : "ambiguous_search_control",
    );
  }

  async #waitForUnique(
    selector: string,
    predicate: (element: Element) => boolean,
    signal: AbortSignal,
  ): Promise<Element> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      abortInteraction(signal);
      const matches = this.#visibleMatches(selector, predicate);
      if (matches.length === 1) return matches[0] as Element;
      if (matches.length > 1) {
        throw new GoogleFlightsInteractionError(
          "INCOMPATIBLE",
          "ambiguous_search_control",
        );
      }
      await waitForTick(this.#view, signal);
    }
    abortInteraction(signal);
    throw new GoogleFlightsInteractionError("INCOMPATIBLE", "search_timeout");
  }

  #visibleMatches(
    selector: string,
    predicate: (element: Element) => boolean,
  ): Element[] {
    const matches: Element[] = [];
    let candidates = 0;
    for (const element of this.#document.querySelectorAll(selector)) {
      candidates += 1;
      if (candidates > MAX_ACTION_CANDIDATES) {
        throw new GoogleFlightsInteractionError(
          "INCOMPATIBLE",
          "ambiguous_search_control",
        );
      }
      if (isVisible(element) && predicate(element)) matches.push(element);
    }
    return matches;
  }
}

function setInputValue(
  view: Window & typeof globalThis,
  input: HTMLInputElement,
  value: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    view.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter === undefined) {
    throw new GoogleFlightsInteractionError(
      "INCOMPATIBLE",
      "missing_search_control",
    );
  }
  setter.call(input, value);
  input.dispatchEvent(
    new view.InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText",
    }),
  );
  input.dispatchEvent(new view.Event("change", { bubbles: true }));
}

function requiredClickable(element: Element): HTMLElement {
  const view = element.ownerDocument.defaultView;
  if (view === null || !(element instanceof view.HTMLElement)) {
    throw new GoogleFlightsInteractionError(
      "INCOMPATIBLE",
      "missing_search_control",
    );
  }
  return element;
}

function waitForTick(
  view: Window & typeof globalThis,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle = view.setTimeout(done, WAIT_INTERVAL_MS);
    signal.addEventListener("abort", cancelled, { once: true });
    function done() {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }
    function cancelled() {
      view.clearTimeout(handle);
      reject(new GoogleFlightsInteractionError("CANCELLED", "cancelled"));
    }
  });
}
