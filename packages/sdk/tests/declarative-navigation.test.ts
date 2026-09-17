import { describe, expect, it } from "vitest";

import {
  createDeclarativeNavigationUrl,
  declarativeNavigationResult,
  validateDeclarativeOperations,
  type DeclarativeNavigateOperation,
} from "../src/index.js";
import type { PackToolManifest } from "../src/types.js";

const operation: DeclarativeNavigateOperation = {
  kind: "navigate",
  tool: "example.change_symbol",
  navigationVersion: 1,
  path: {
    segments: [
      { kind: "literal", value: "chart" },
      { kind: "argument", name: "symbol" },
    ],
    trailingSlash: false,
  },
  query: [
    { key: "market", value: { kind: "argument", name: "market" } },
    { key: "mode", value: { kind: "literal", value: "advanced view" } },
  ],
};

describe("declarative same-origin navigation", () => {
  const tool: PackToolManifest = {
    name: "example.change_symbol",
    description: "Open one symbol",
    risk: "action",
    permissions: ["ACTION"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["symbol", "market"],
      properties: {
        symbol: {
          type: "string",
          minLength: 1,
          maxLength: 32,
        },
        market: {
          type: "string",
          minLength: 1,
          maxLength: 8,
          enum: ["US", "UK"],
        },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["state", "url"],
      properties: {
        state: { const: "scheduled" },
        url: { type: "string", maxLength: 2048 },
      },
    },
  };

  it("accepts navigation only in Operations v2 with exact action metadata", () => {
    expect(
      validateDeclarativeOperations(
        { version: 2, operations: [operation] },
        [tool],
        2,
      ),
    ).toBeUndefined();
    expect(
      validateDeclarativeOperations(
        { version: 1, operations: [operation] },
        [tool],
        1,
      ),
    ).toMatchObject({ code: "UNSUPPORTED_OPERATION" });
  });

  it("rejects duplicate query keys and argument reuse", () => {
    expect(
      validateDeclarativeOperations(
        {
          version: 2,
          operations: [
            {
              ...operation,
              query: [
                ...operation.query,
                {
                  key: "market",
                  value: { kind: "argument", name: "symbol" },
                },
              ],
            },
          ],
        },
        [tool],
        2,
      ),
    ).toMatchObject({ code: "DUPLICATE_VALUE" });
  });

  it("rejects unsupported regex constraints at the signed contract boundary", () => {
    const constrained = structuredClone(tool);
    const properties = constrained.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    const symbol = properties["symbol"];
    if (symbol === undefined) throw new Error("symbol schema missing");
    symbol["pattern"] = "^(a+)+$";
    expect(
      validateDeclarativeOperations(
        { version: 2, operations: [operation] },
        [constrained],
        2,
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
  });

  it("encodes path segments and static query keys without changing the origin", () => {
    const url = createDeclarativeNavigationUrl(
      operation,
      { symbol: "NASDAQ:Å B+D", market: "United/States#all" },
      "https://charts.example.test",
    );
    expect(url).toBe(
      "https://charts.example.test/chart/NASDAQ%3A%C3%85%20B%2BD?market=United%2FStates%23all&mode=advanced%20view",
    );
    expect(declarativeNavigationResult(url)).toEqual({
      state: "scheduled",
      url,
    });
  });

  it.each([
    "https://evil.example/path",
    "  HTTPS://evil.example/path",
    "//evil.example/path",
    "javascript:alert(1)",
    "..",
    ".",
    "../admin",
    "a/../../admin",
    "%2e%2e",
    "%2Fadmin",
    "bad\\path",
    "line\nbreak",
  ])(
    "rejects an argument that can act as URL or traversal syntax: %s",
    (value) => {
      expect(() =>
        createDeclarativeNavigationUrl(
          operation,
          { symbol: value, market: "US" },
          "https://charts.example.test",
        ),
      ).toThrow(/navigation/u);
    },
  );

  it.each([
    "http://charts.example.test",
    "https://charts.example.test/path",
    "https://user@charts.example.test",
    "https://charts.example.test#fragment",
  ])("rejects a non-canonical HTTPS origin: %s", (origin) => {
    expect(() =>
      createDeclarativeNavigationUrl(
        operation,
        { symbol: "NASDAQ:AAPL", market: "US" },
        origin,
      ),
    ).toThrow(/origin/u);
  });
});
