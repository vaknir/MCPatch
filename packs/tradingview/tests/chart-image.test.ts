import { isPackExecutionResult } from "@mcpatch/sdk/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  TradingViewPackError,
  captureTradingViewChartImage,
} from "../src/index.js";

describe("TradingView active chart image", () => {
  it("composites only canvases inside the one reviewed chart region", () => {
    const drawImage = vi.fn();
    const fixture = chartDocument(drawImage);

    const captured = captureTradingViewChartImage(
      fixture.document,
      "NASDAQ:AAPL",
      new AbortController().signal,
    );

    expect(isPackExecutionResult(captured)).toBe(true);
    expect(captured.result).toEqual({
      fingerprint: "tradingview-chart-semantic-en-v1",
      symbol: "NASDAQ:AAPL",
      mimeType: "image/webp",
      width: 1_600,
      height: 1_000,
    });
    expect(captured.content).toEqual([
      {
        type: "image",
        mimeType: "image/webp",
        data: "UklGRg==",
        width: 1_600,
        height: 1_000,
      },
    ]);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(fixture.document.querySelectorAll).toHaveBeenCalledTimes(1);
    expect(fixture.document.querySelectorAll).toHaveBeenCalledWith(
      '[role="region"][aria-label^="Chart #"]',
    );
  });

  it("fails closed on ambiguous regions, out-of-region canvases, and cancellation", () => {
    const ambiguous = chartDocument(vi.fn(), { regionCount: 2 });
    expect(() =>
      captureTradingViewChartImage(
        ambiguous.document,
        "NASDAQ:AAPL",
        new AbortController().signal,
      ),
    ).toThrow(TradingViewPackError);

    const escaped = chartDocument(vi.fn(), { escapedCanvas: true });
    expect(() =>
      captureTradingViewChartImage(
        escaped.document,
        "NASDAQ:AAPL",
        new AbortController().signal,
      ),
    ).toThrow(TradingViewPackError);

    const cancelled = new AbortController();
    cancelled.abort();
    expect(() =>
      captureTradingViewChartImage(
        chartDocument(vi.fn()).document,
        "NASDAQ:AAPL",
        cancelled.signal,
      ),
    ).toThrow(expect.objectContaining({ code: "CANCELLED" }));
  });

  it("rejects an image that stays above the transport byte bound", () => {
    const oversized = "A".repeat(218_456);
    const fixture = chartDocument(vi.fn(), { encoded: oversized });

    expect(() =>
      captureTradingViewChartImage(
        fixture.document,
        "NASDAQ:AAPL",
        new AbortController().signal,
      ),
    ).toThrow(expect.objectContaining({ reason: "chart_capture_unavailable" }));
    expect(fixture.createElement).toHaveBeenCalledTimes(3);
  });
});

function chartDocument(
  drawImage: ReturnType<typeof vi.fn>,
  options: {
    readonly encoded?: string;
    readonly escapedCanvas?: boolean;
    readonly regionCount?: number;
  } = {},
) {
  const regionRect = rect(0, 0, 1_920, 1_200);
  const canvases = [
    canvas(rect(0, 0, 1_800, 1_200)),
    canvas(rect(options.escapedCanvas ? 1_900 : 1_800, 0, 120, 1_200)),
  ];
  const region = element(regionRect, new Map([["canvas", canvases]]));
  const regions = new Array(options.regionCount ?? 1).fill(region);
  const querySelectorAll = vi.fn((selector: string) =>
    selector === '[role="region"][aria-label^="Chart #"]' ? regions : [],
  );
  const createElement = vi.fn(() =>
    Object.assign(element(rect(0, 0, 1, 1)), {
      width: 0,
      height: 0,
      getContext() {
        return {
          fillStyle: "",
          fillRect: vi.fn(),
          drawImage,
        };
      },
      toDataURL() {
        return `data:image/webp;base64,${options.encoded ?? "UklGRg=="}`;
      },
    }),
  );
  const document = {
    nodeType: 9,
    querySelectorAll,
    createElement,
  } as unknown as Document;
  return { createElement, document };
}

function canvas(bounds: DOMRect): HTMLCanvasElement {
  return Object.assign(element(bounds), {
    width: 1_920,
    height: 1_200,
  }) as unknown as HTMLCanvasElement;
}

function element(
  bounds: DOMRect,
  selectors: ReadonlyMap<string, readonly Element[]> = new Map(),
): Element {
  return {
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return bounds;
    },
    getClientRects() {
      return [bounds];
    },
    querySelectorAll(selector: string) {
      return selectors.get(selector) ?? [];
    },
  } as unknown as Element;
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON() {
      return {};
    },
  };
}
