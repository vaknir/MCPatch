import {
  imageResult,
  MAX_PACK_IMAGE_BYTES,
  type PackExecutionResult,
} from "@mcpatch/sdk/runtime";

import {
  TRADINGVIEW_FINGERPRINT,
  TradingViewPackError,
  type TradingViewCaptureChartResult,
} from "./model.js";
import { isCanonicalTradingViewSymbol } from "./symbol.js";

const MAX_CANVASES = 16;
const MAX_OUTPUT_WIDTH = 1_600;
const MAX_OUTPUT_HEIGHT = 1_200;
const MAX_SOURCE_DIMENSION = 4_096;
const SCALE_ATTEMPTS = [1, 0.8, 0.64] as const;
const WEBP_QUALITY = 0.82;
const WEBP_PREFIX = "data:image/webp;base64,";

export function captureTradingViewChartImage(
  document: Document,
  symbol: string,
  signal: AbortSignal,
): PackExecutionResult<TradingViewCaptureChartResult> {
  abortIfNeeded(signal);
  if (document?.nodeType !== 9 || !isCanonicalTradingViewSymbol(symbol)) {
    unavailable();
  }
  const regions = Array.from(
    document.querySelectorAll('[role="region"][aria-label^="Chart #"]'),
  ).filter(isVisible);
  if (regions.length !== 1) unavailable();
  const region = regions[0];
  if (region === undefined) unavailable();
  const bounds = region.getBoundingClientRect();
  if (!validRect(bounds)) unavailable();
  const canvases = Array.from(region.querySelectorAll("canvas")).filter(
    isVisible,
  );
  if (canvases.length < 1 || canvases.length > MAX_CANVASES) unavailable();
  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect();
    if (
      !validRect(rect) ||
      canvas.width < 1 ||
      canvas.height < 1 ||
      canvas.width > MAX_SOURCE_DIMENSION ||
      canvas.height > MAX_SOURCE_DIMENSION ||
      rect.left < bounds.left - 1 ||
      rect.top < bounds.top - 1 ||
      rect.right > bounds.right + 1 ||
      rect.bottom > bounds.bottom + 1
    ) {
      unavailable();
    }
  }

  const fit = Math.min(
    1,
    MAX_OUTPUT_WIDTH / bounds.width,
    MAX_OUTPUT_HEIGHT / bounds.height,
  );
  for (const attempt of SCALE_ATTEMPTS) {
    abortIfNeeded(signal);
    const scale = fit * attempt;
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d", { alpha: false });
    if (context === null) unavailable();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    for (const canvas of canvases) {
      abortIfNeeded(signal);
      const rect = canvas.getBoundingClientRect();
      context.drawImage(
        canvas,
        Math.round((rect.left - bounds.left) * scale),
        Math.round((rect.top - bounds.top) * scale),
        Math.max(1, Math.round(rect.width * scale)),
        Math.max(1, Math.round(rect.height * scale)),
      );
    }
    let encoded: string;
    try {
      encoded = output.toDataURL("image/webp", WEBP_QUALITY);
    } catch {
      unavailable();
    }
    if (!encoded.startsWith(WEBP_PREFIX)) unavailable();
    const data = encoded.slice(WEBP_PREFIX.length);
    if (decodedBytes(data) > MAX_PACK_IMAGE_BYTES) continue;
    const result = Object.freeze({
      fingerprint: TRADINGVIEW_FINGERPRINT,
      symbol,
      mimeType: "image/webp" as const,
      width,
      height,
    });
    return imageResult(result, {
      type: "image",
      mimeType: "image/webp",
      data,
      width,
      height,
    });
  }
  unavailable();
}

function decodedBytes(value: string): number {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    return Number.POSITIVE_INFINITY;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function validRect(rect: DOMRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 1 &&
    rect.height >= 1
  );
}

function isVisible(element: Element): boolean {
  return (
    element.getAttribute("aria-hidden") !== "true" &&
    element.getClientRects().length > 0
  );
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TradingViewPackError("CANCELLED", "cancelled");
  }
}

function unavailable(): never {
  throw new TradingViewPackError(
    "EXECUTION_FAILED",
    "chart_capture_unavailable",
  );
}
