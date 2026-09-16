import type {
  DeclarativeLocator,
  DeclarativeRoleLocator,
  DeclarativeSafeAttribute,
  DeclarativeStructuredSelector,
} from "@mcpatch/sdk/runtime";

import type {
  DeclarativeDocumentAdapter,
  DeclarativeLocateLimits,
  DeclarativeLocateResult,
  DeclarativeNodeHandle,
  DeclarativeReadResult,
} from "./declarative-document-model.js";

const HIDDEN_TEXT_CONTAINERS = new Set([
  "noscript",
  "script",
  "style",
  "template",
]);

type DomHandle = DeclarativeNodeHandle;

/** Packaged, isolated-world DOM access for the closed declarative language. */
export class DeclarativeDomAdapter implements DeclarativeDocumentAdapter {
  readonly #document: Document;
  readonly #elements = new WeakMap<DeclarativeNodeHandle, Element>();

  constructor(document: Document) {
    this.#document = document;
  }

  async locate(
    parent: DeclarativeNodeHandle | undefined,
    locator: DeclarativeLocator,
    limits: DeclarativeLocateLimits,
    signal: AbortSignal,
  ): Promise<DeclarativeLocateResult> {
    if (
      !Number.isSafeInteger(limits.maxMatches) ||
      limits.maxMatches < 1 ||
      !Number.isSafeInteger(limits.maxVisits) ||
      limits.maxVisits < 0
    ) {
      throw new TypeError("declarative locate limits were rejected");
    }
    signal.throwIfAborted();
    const root = parent === undefined ? this.#document : this.#resolve(parent);
    const stack =
      parent === undefined
        ? this.#document.documentElement === null
          ? []
          : [this.#document.documentElement]
        : childElements(root as Element);
    const handles: DeclarativeNodeHandle[] = [];
    let visited = 0;
    let visitLimitExceeded = false;
    let matchLimitExceeded = false;

    while (true) {
      signal.throwIfAborted();
      const node = stack.pop();
      if (node === undefined) break;
      if (visited >= limits.maxVisits) {
        visitLimitExceeded = true;
        break;
      }
      visited += 1;
      if (hidesText(node)) continue;
      const matched =
        locator.kind === "role"
          ? matchRole(node, locator, limits.maxVisits - visited, signal)
          : { matched: matchStructured(node, locator), visited: 0 };
      visited += matched.visited;
      if (visited > limits.maxVisits) {
        visitLimitExceeded = true;
        break;
      }
      stack.push(...childElements(node));
      if (!matched.matched) continue;
      if (handles.length >= limits.maxMatches) {
        matchLimitExceeded = true;
        break;
      }
      handles.push(this.#handle(node));
    }
    signal.throwIfAborted();
    return Object.freeze({
      handles: Object.freeze(handles),
      visited: Math.min(visited, limits.maxVisits),
      matchLimitExceeded,
      visitLimitExceeded,
    });
  }

  async readText(
    handle: DeclarativeNodeHandle,
    maxCodePoints: number,
    maxVisits: number,
    signal: AbortSignal,
  ): Promise<DeclarativeReadResult> {
    validateReadLimits(maxCodePoints, maxVisits);
    signal.throwIfAborted();
    const result = collectText(
      this.#resolve(handle),
      maxCodePoints,
      maxVisits,
      signal,
    );
    return Object.freeze(result);
  }

  async readAttribute(
    handle: DeclarativeNodeHandle,
    name: DeclarativeSafeAttribute,
    maxCodePoints: number,
    signal: AbortSignal,
  ): Promise<Omit<DeclarativeReadResult, "visited">> {
    validateReadLimits(maxCodePoints, 0);
    signal.throwIfAborted();
    const value = this.#resolve(handle).getAttribute(name) ?? undefined;
    signal.throwIfAborted();
    return Object.freeze({
      ...(value === undefined ? {} : { value }),
      limitExceeded:
        value !== undefined && Array.from(value).length > maxCodePoints,
    });
  }

  #handle(element: Element): DomHandle {
    const handle = Object.freeze({}) as DomHandle;
    this.#elements.set(handle, element);
    return handle;
  }

  #resolve(handle: DeclarativeNodeHandle): Element {
    const element = this.#elements.get(handle);
    if (
      element === undefined ||
      element.ownerDocument !== this.#document ||
      !element.isConnected
    ) {
      throw new TypeError("declarative node handle is stale");
    }
    return element;
  }
}

function matchStructured(
  element: Element,
  locator: DeclarativeStructuredSelector,
): boolean {
  if (locator.tag !== undefined && element.localName !== locator.tag) {
    return false;
  }
  if (locator.id !== undefined && element.id !== locator.id) return false;
  if (
    locator.classes !== undefined &&
    locator.classes.some((className) => !element.classList.contains(className))
  ) {
    return false;
  }
  return (
    locator.attributes === undefined ||
    locator.attributes.every(
      (attribute) => element.getAttribute(attribute.name) === attribute.value,
    )
  );
}

function matchRole(
  element: Element,
  locator: DeclarativeRoleLocator,
  remainingVisits: number,
  signal: AbortSignal,
): { readonly matched: boolean; readonly visited: number } {
  if (elementRole(element) !== locator.role) {
    return { matched: false, visited: 0 };
  }
  if (locator.name === undefined) return { matched: true, visited: 0 };
  const labelled =
    element.getAttribute("aria-label") ??
    element.getAttribute("alt") ??
    element.getAttribute("title");
  if (labelled !== null) {
    return { matched: labelled === locator.name, visited: 0 };
  }
  const text = collectText(
    element,
    Array.from(locator.name).length,
    remainingVisits,
    signal,
  );
  return {
    matched: !text.limitExceeded && text.value === locator.name,
    visited: text.visited,
  };
}

function elementRole(element: Element): string | undefined {
  const explicit = element.getAttribute("role")?.trim().toLowerCase();
  if (explicit !== undefined && explicit !== "") return explicit;
  switch (element.localName) {
    case "a":
      return element.hasAttribute("href") ? "link" : undefined;
    case "article":
      return "article";
    case "button":
      return "button";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "img":
      return "img";
    case "li":
      return "listitem";
    case "main":
      return "main";
    case "nav":
      return "navigation";
    case "ol":
    case "ul":
      return "list";
    case "option":
      return "option";
    case "progress":
      return "progressbar";
    case "table":
      return "table";
    case "td":
      return "cell";
    case "textarea":
      return "textbox";
    case "th":
      return "columnheader";
    case "tr":
      return "row";
    case "input":
      return inputRole(element);
    case "select":
      return element.hasAttribute("multiple") ? "listbox" : "combobox";
    default:
      return undefined;
  }
}

function inputRole(element: Element): string | undefined {
  switch ((element.getAttribute("type") ?? "text").toLowerCase()) {
    case "button":
    case "reset":
    case "submit":
      return "button";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "range":
      return "slider";
    case "number":
      return "spinbutton";
    case "search":
      return "searchbox";
    case "email":
    case "tel":
    case "text":
    case "url":
      return "textbox";
    default:
      return undefined;
  }
}

function collectText(
  root: Element,
  maxCodePoints: number,
  maxVisits: number,
  signal: AbortSignal,
): DeclarativeReadResult {
  if (hidesText(root)) return { visited: 0, limitExceeded: false };
  const stack: Node[] = [];
  for (let index = root.childNodes.length - 1; index >= 0; index -= 1) {
    const child = root.childNodes.item(index);
    if (child !== null) stack.push(child);
  }
  const codePoints: string[] = [];
  let visited = 0;
  let limitExceeded = false;
  while (stack.length > 0) {
    signal.throwIfAborted();
    if (visited >= maxVisits) {
      return { visited, limitExceeded: true };
    }
    const node = stack.pop();
    if (node === undefined) break;
    visited += 1;
    if (node.nodeType === 3) {
      for (const codePoint of node.nodeValue ?? "") {
        if (codePoints.length >= maxCodePoints) {
          limitExceeded = true;
          break;
        }
        codePoints.push(codePoint);
      }
      if (limitExceeded) break;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (hidesText(element)) continue;
    for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
      const child = element.childNodes.item(index);
      if (child !== null) stack.push(child);
    }
  }
  return {
    value: codePoints.join(""),
    visited,
    limitExceeded,
  };
}

function hidesText(element: Element): boolean {
  return (
    HIDDEN_TEXT_CONTAINERS.has(element.localName) ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true"
  );
}

function validateReadLimits(maxCodePoints: number, maxVisits: number): void {
  if (
    !Number.isSafeInteger(maxCodePoints) ||
    maxCodePoints < 0 ||
    !Number.isSafeInteger(maxVisits) ||
    maxVisits < 0
  ) {
    throw new TypeError("declarative read limits were rejected");
  }
}

function childElements(parent: Element): Element[] {
  const children: Element[] = [];
  for (let index = parent.children.length - 1; index >= 0; index -= 1) {
    const child = parent.children.item(index);
    if (child !== null) children.push(child);
  }
  return children;
}
