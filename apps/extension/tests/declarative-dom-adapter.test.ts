import { describe, expect, it } from "vitest";

import { DeclarativeDomAdapter } from "../src/declarative-dom-adapter.js";

describe("declarative DOM adapter", () => {
  it("traverses static locators in document order and excludes hidden semantic content", async () => {
    const fixture = documentFixture(
      element("html", {}, [
        element("body", {}, [
          element("script", { role: "main" }, [text("credential-like-data")]),
          element("main", {}, [
            element("span", { class: "price current" }, [text("$42")]),
            element("span", { class: "price" }, [text("$50")]),
            element("style", {}, [text("hidden-style-data")]),
          ]),
        ]),
      ]),
    );
    const adapter = new DeclarativeDomAdapter(fixture.document);
    const main = await adapter.locate(
      undefined,
      { kind: "role", role: "main" },
      { maxMatches: 1, maxVisits: 16 },
      signal(),
    );
    expect(main.handles).toHaveLength(1);
    expect(main.matchLimitExceeded).toBe(false);
    const root = main.handles[0];
    if (root === undefined) throw new Error("main handle missing");

    const prices = await adapter.locate(
      root,
      { kind: "selector", tag: "span", classes: ["price"] },
      { maxMatches: 2, maxVisits: 8 },
      signal(),
    );
    expect(prices.handles).toHaveLength(2);
    const first = prices.handles[0];
    if (first === undefined) throw new Error("price handle missing");
    await expect(adapter.readText(first, 3, 4, signal())).resolves.toEqual({
      value: "$42",
      visited: 1,
      limitExceeded: false,
    });
    await expect(adapter.readText(root, 16, 16, signal())).resolves.toEqual({
      value: "$42$50",
      visited: 5,
      limitExceeded: false,
    });
  });

  it("detects match, visit, text, and attribute bounds without exposing a DOM node", async () => {
    const fixture = documentFixture(
      element("html", {}, [
        element("body", {}, [
          element("main", { title: "long" }, [
            element("span", { class: "item" }, [text("first")]),
            element("span", { class: "item" }, [text("second")]),
          ]),
        ]),
      ]),
    );
    const adapter = new DeclarativeDomAdapter(fixture.document);
    const limited = await adapter.locate(
      undefined,
      { kind: "selector", classes: ["item"] },
      { maxMatches: 1, maxVisits: 8 },
      signal(),
    );
    expect(limited.matchLimitExceeded).toBe(true);
    expect(Object.keys(limited.handles[0] ?? {})).toEqual([]);

    const exhausted = await adapter.locate(
      undefined,
      { kind: "selector", classes: ["missing"] },
      { maxMatches: 1, maxVisits: 1 },
      signal(),
    );
    expect(exhausted.visitLimitExceeded).toBe(true);

    const main = await adapter.locate(
      undefined,
      { kind: "role", role: "main" },
      { maxMatches: 1, maxVisits: 8 },
      signal(),
    );
    const handle = main.handles[0];
    if (handle === undefined) throw new Error("main handle missing");
    await expect(
      adapter.readText(handle, 3, 8, signal()),
    ).resolves.toMatchObject({
      limitExceeded: true,
    });
    await expect(
      adapter.readAttribute(handle, "title", 3, signal()),
    ).resolves.toEqual({ value: "long", limitExceeded: true });

    fixture.detach();
    await expect(adapter.readText(handle, 8, 8, signal())).rejects.toThrow(
      TypeError,
    );
  });
});

interface FakeText {
  readonly nodeType: 3;
  readonly nodeValue: string;
}

interface FakeElement {
  readonly nodeType: 1;
  readonly localName: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: FakeCollection<FakeElement>;
  readonly childNodes: FakeCollection<FakeElement | FakeText>;
  readonly classList: { contains(value: string): boolean };
  readonly id: string;
  isConnected: boolean;
  ownerDocument?: FakeDocument;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

interface FakeDocument {
  readonly documentElement: FakeElement;
}

interface FakeCollection<T> {
  readonly length: number;
  item(index: number): T | null;
}

function text(value: string): FakeText {
  return { nodeType: 3, nodeValue: value };
}

function element(
  localName: string,
  attributes: Readonly<Record<string, string>>,
  nodes: readonly (FakeElement | FakeText)[],
): FakeElement {
  const children = nodes.filter(
    (node): node is FakeElement => node.nodeType === 1,
  );
  const classes = new Set(
    (attributes.class ?? "").split(/\s+/u).filter(Boolean),
  );
  return {
    nodeType: 1,
    localName,
    attributes,
    children: collection(children),
    childNodes: collection(nodes),
    classList: { contains: (value) => classes.has(value) },
    id: attributes.id ?? "",
    isConnected: true,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
  };
}

function collection<T>(values: readonly T[]): FakeCollection<T> {
  return {
    length: values.length,
    item: (index) => values[index] ?? null,
  };
}

function documentFixture(root: FakeElement) {
  const document: FakeDocument = { documentElement: root };
  assignDocument(root, document);
  return {
    document: document as unknown as Document,
    detach() {
      // The test has only one main element; detaching the tree invalidates all handles.
      const main = findElement(
        root,
        (candidate) => candidate.localName === "main",
      );
      if (main === undefined) throw new Error("main missing");
      main.isConnected = false;
    },
  };
}

function assignDocument(
  elementValue: FakeElement,
  document: FakeDocument,
): void {
  elementValue.ownerDocument = document;
  for (let index = 0; index < elementValue.children.length; index += 1) {
    const child = elementValue.children.item(index);
    if (child !== null) assignDocument(child, document);
  }
}

function findElement(
  root: FakeElement,
  predicate: (candidate: FakeElement) => boolean,
): FakeElement | undefined {
  if (predicate(root)) return root;
  for (let index = 0; index < root.children.length; index += 1) {
    const child = root.children.item(index);
    if (child === null) continue;
    const found = findElement(child, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function signal(): AbortSignal {
  return new AbortController().signal;
}
