import type { GoogleFlightsSnapshotSource } from "./adapter.js";
import {
  createCoalescedChangeSubscription,
  type GoogleFlightsChangeScheduler,
} from "./coalescing.js";
import { collectControls } from "./dom-controls.js";
import {
  collectCards,
  collectPriceSemantics,
  collectResultSemantics,
} from "./dom-results.js";
import {
  CONTROL_TEXT_LIMIT,
  RESULT_TEXT_LIMIT,
  abortIfNeeded,
  isVisible,
  readElementText,
  semanticElements,
} from "./dom-shared.js";
import type {
  GoogleFlightsSemanticSnapshot,
  SemanticTextCandidate,
} from "./model.js";

export function createGoogleFlightsDocumentSource(
  document: Document,
): GoogleFlightsSnapshotSource {
  return new GoogleFlightsDocumentSource(document);
}

/** Reads only the reviewed, bounded semantic surface from one document. */
export function collectGoogleFlightsSemanticSnapshot(
  document: Document,
  signal: AbortSignal,
): GoogleFlightsSemanticSnapshot {
  abortIfNeeded(signal);
  const location = document.location;
  const controls = collectControls(document, signal);
  const cards = collectCards(document, signal);
  const statusElements = semanticElements(
    document,
    '[role="status"],[aria-live="polite"],[aria-live="assertive"]',
    signal,
  );
  const headingElements = semanticElements(
    document,
    'h1,h2,h3,h4,[role="heading"]',
    signal,
  );
  const statusTexts = elementCandidates(statusElements, RESULT_TEXT_LIMIT);
  const headings = elementCandidates(headingElements, CONTROL_TEXT_LIMIT);
  const results = collectResultSemantics(
    document,
    cards,
    statusTexts,
    headings,
    signal,
  );
  const priceInsights = collectPriceSemantics(
    statusTexts,
    headingElements,
    signal,
  );
  abortIfNeeded(signal);
  return {
    origin: location.origin,
    pathname: location.pathname,
    language: document.documentElement.lang,
    controls,
    ...(results === undefined ? {} : { results }),
    ...(priceInsights === undefined ? {} : { priceInsights }),
  };
}

class GoogleFlightsDocumentSource implements GoogleFlightsSnapshotSource {
  readonly #document: Document;

  constructor(document: Document) {
    if (document?.nodeType !== 9) {
      throw new TypeError("Google Flights document source is invalid");
    }
    this.#document = document;
  }

  read(signal: AbortSignal): GoogleFlightsSemanticSnapshot {
    return collectGoogleFlightsSemanticSnapshot(this.#document, signal);
  }

  subscribe(listener: () => void): () => void {
    const view = this.#document.defaultView;
    const root = this.#document.documentElement;
    if (view === null || root === null) {
      throw new TypeError("Google Flights document cannot be observed");
    }
    const scheduler: GoogleFlightsChangeScheduler = {
      schedule(callback, delayMs) {
        return view.setTimeout(callback, delayMs);
      },
      cancel(handle) {
        view.clearTimeout(handle as number);
      },
    };
    return createCoalescedChangeSubscription({
      observe: (changed) => observeDocument(view, root, changed),
      readSignature: () => this.#signature(),
      listener,
      scheduler,
    });
  }

  #signature(): string {
    try {
      const snapshot = this.read(new AbortController().signal);
      return hashSignature(JSON.stringify(snapshot));
    } catch {
      return "incompatible";
    }
  }
}

function elementCandidates(
  elements: readonly Element[],
  maximum: number,
): SemanticTextCandidate[] {
  return elements.map((element) => ({
    visible: isVisible(element),
    text: readElementText(element, maximum),
  }));
}

function observeDocument(
  view: Window & typeof globalThis,
  root: Element,
  changed: () => void,
): () => void {
  const observer = new view.MutationObserver(changed);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["aria-busy", "aria-hidden", "aria-label", "value"],
    characterData: true,
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}

function hashSignature(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
