import { describe, expect, it } from "vitest";

import {
  imageResult,
  isPackExecutionResult,
  MAX_PACK_IMAGE_BYTES,
  MAX_PACK_IMAGE_DIMENSION,
  structuredResult,
} from "../src/index.js";

describe("bounded pack tool results", () => {
  it("brands one image result without mixing media into structured data", () => {
    const execution = imageResult(
      { symbol: "NASDAQ:AAPL", width: 2, height: 1 },
      {
        type: "image",
        mimeType: "image/webp",
        data: "UklGRg==",
        width: 2,
        height: 1,
      },
    );

    expect(isPackExecutionResult(execution)).toBe(true);
    expect(structuredResult(execution)).toEqual({
      symbol: "NASDAQ:AAPL",
      width: 2,
      height: 1,
    });
    expect(execution.content).toHaveLength(1);
    expect(Object.isFrozen(execution)).toBe(true);
    expect(Object.isFrozen(execution.content)).toBe(true);
  });

  it("rejects invalid dimensions, media types, and decoded byte lengths", () => {
    const create = (overrides: Record<string, unknown>) =>
      imageResult({}, {
        type: "image",
        mimeType: "image/webp",
        data: "UklGRg==",
        width: 1,
        height: 1,
        ...overrides,
      } as never);

    expect(() => create({ width: MAX_PACK_IMAGE_DIMENSION + 1 })).toThrow(
      TypeError,
    );
    expect(() => create({ mimeType: "image/svg+xml" })).toThrow(TypeError);
    expect(() =>
      create({
        data: Buffer.alloc(MAX_PACK_IMAGE_BYTES + 1).toString("base64"),
      }),
    ).toThrow(TypeError);
  });

  it("does not recognize an unbranded lookalike as an execution envelope", () => {
    expect(
      isPackExecutionResult({
        result: {},
        content: [
          {
            type: "image",
            mimeType: "image/webp",
            data: "UklGRg==",
            width: 1,
            height: 1,
          },
        ],
      }),
    ).toBe(false);
  });
});
