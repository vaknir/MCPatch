import { describe, expect, it, vi } from "vitest";

import {
  collectTradingViewSemanticSnapshot,
  createTradingViewDocumentSource,
} from "../src/index.js";

describe("TradingView document source", () => {
  it("collects only bounded reviewed chart and watchlist semantics", () => {
    const snapshot = collectTradingViewSemanticSnapshot(
      tradingViewDocument(),
      new AbortController().signal,
    );

    expect(snapshot).toEqual({
      origin: "https://www.tradingview.com",
      pathname: "/chart/",
      language: "en",
      documentTitle: "AAPL 331.34 ▼ −0.52%",
      symbolParameter: "NASDAQ:AAPL",
      charts: [
        {
          names: ["Apple Inc"],
          intervals: ["1D"],
          exchanges: ["NASDAQ"],
          canvasLabels: ["Chart for BATS:AAPL, 1 day"],
          ohlc: ["O330.14", "H331.78", "L328.35", "C331.34"],
          changes: ["−1.74 (−0.52%)"],
          volumes: ["31.75 M"],
          currencies: ["USD"],
        },
      ],
      watchlist: [
        {
          symbol: "NASDAQ:AAPL",
          ticker: "AAPL",
          values: ["331.34", "−1.74", "−0.52%", "31.75 M"],
          marketStatus: "Overnight",
          active: true,
        },
      ],
    });
  });

  it("schedules only a validated same-origin chart URL", () => {
    const schedule = vi.fn();
    const source = createTradingViewDocumentSource(tradingViewDocument(), {
      schedule,
    });

    source.changeSymbol?.({ symbol: "NYSE:IBM" }, new AbortController().signal);

    expect(schedule).toHaveBeenCalledWith(
      "https://www.tradingview.com/chart/?symbol=NYSE%3AIBM",
    );
  });
});

function tradingViewDocument(): Document {
  const ohlc = ["O330.14", "H331.78", "L328.35", "C331.34"].map((text) =>
    fakeElement({ text }),
  );
  const change = fakeElement({ text: "−1.74 (−0.52%)" });
  const aggregate = fakeElement({ text: "x".repeat(100) });
  const chart = fakeElement({
    selectors: new Map([
      ["div", [aggregate, ...ohlc, change]],
      ['[aria-label="Change symbol"]', [fakeElement({ text: "Apple Inc" })]],
      ['[aria-label="Change interval"]', [fakeElement({ text: "1D" })]],
      [
        '[title*=" — "]',
        [
          fakeElement({
            text: "NASDAQ",
            attributes: { title: "NASDAQ — NASDAQ Stock Market" },
          }),
        ],
      ],
      [
        '[aria-label^="Chart for "]',
        [
          fakeElement({
            attributes: { "aria-label": "Chart for BATS:AAPL, 1 day" },
          }),
        ],
      ],
      ['[title="Volume"]', [fakeElement({ text: "31.75 M" })]],
      ['[data-name="currency-label-selector"]', [fakeElement({ text: "USD" })]],
    ]),
  });
  const status = fakeElement({ attributes: { title: "Overnight" } });
  const row = fakeElement({
    attributes: {
      "data-symbol-full": "NASDAQ:AAPL",
      "data-symbol-short": "AAPL",
      "data-active": "true",
    },
    children: [
      fakeElement({ tagName: "DIV" }),
      ...["331.34", "−1.74", "−0.52%", "31.75 M"].map((text) =>
        fakeElement({ tagName: "SPAN", text }),
      ),
    ],
    selectors: new Map([["[title]", [status]]]),
  });
  const watchlist = fakeElement({
    selectors: new Map([["[data-symbol-full][data-symbol-short]", [row]]]),
  });
  const selectors = new Map<string, Element[]>([
    ['[role="region"][aria-label^="Chart #"]', [chart]],
    ['[data-name="symbol-list-wrap"]', [watchlist]],
  ]);
  return {
    nodeType: 9,
    title: "AAPL 331.34 ▼ −0.52%",
    location: {
      href: "https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL",
      origin: "https://www.tradingview.com",
      pathname: "/chart/",
    },
    documentElement: { lang: "en" },
    querySelectorAll(selector: string) {
      return selectors.get(selector) ?? [];
    },
  } as unknown as Document;
}

interface FakeElementOptions {
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: readonly Element[];
  readonly selectors?: ReadonlyMap<string, readonly Element[]>;
  readonly tagName?: string;
  readonly text?: string;
}

function fakeElement(options: FakeElementOptions = {}): Element {
  return {
    tagName: options.tagName ?? "DIV",
    textContent: options.text ?? "",
    children: options.children ?? [],
    getAttribute(name: string) {
      return options.attributes?.[name] ?? null;
    },
    getClientRects() {
      return [{ width: 1, height: 1 }];
    },
    querySelectorAll(selector: string) {
      return options.selectors?.get(selector) ?? [];
    },
  } as unknown as Element;
}
