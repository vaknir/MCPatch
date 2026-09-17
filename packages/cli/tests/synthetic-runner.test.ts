import { PROTOCOL_VERSION } from "@mcpatch/protocol";
import { verifyDeclarativeFixtures } from "@mcpatch/sdk/declarative-fixtures";
import { describe, expect, it } from "vitest";

import { preparePackSource } from "../src/source.js";
import { syntheticFixtureRunner } from "../src/synthetic-runner.js";

describe("synthetic declarative runner", () => {
  it("constructs typed navigation fixtures without a browser or page automation", async () => {
    const pack = await preparePackSource(navigationSource());

    await expect(
      verifyDeclarativeFixtures(pack, syntheticFixtureRunner),
    ).resolves.toEqual({
      passed: true,
      fixtures: [
        {
          id: "change-symbol",
          tool: "example.change_symbol",
          status: "passed",
        },
      ],
    });
    expect(pack.bundleContent.operations.operationsVersion).toBe(2);
  });

  it("executes a bounded descendant list through the authored fixture harness", async () => {
    const pack = await preparePackSource(
      source({
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              maxItems: 2,
              items: { type: "string" },
            },
          },
        },
        availability: { kind: "role", role: "list" },
        scope: {
          kind: "single",
          locator: { kind: "role", role: "list" },
        },
        projection: {
          kind: "object",
          fields: [
            {
              key: "items",
              value: {
                kind: "descendant",
                scope: {
                  kind: "list",
                  locator: {
                    kind: "selector",
                    tag: "li",
                    classes: ["item"],
                  },
                  maxMatches: 2,
                },
                projection: { kind: "text" },
              },
            },
          ],
        },
        document: {
          url: "https://example.test/",
          root: {
            tag: "ul",
            role: "list",
            children: [
              { tag: "li", classes: ["item"], text: "One" },
              { tag: "li", classes: ["item"], text: "Two" },
            ],
          },
        },
        result: { items: ["One", "Two"] },
      }),
    );

    await expect(
      verifyDeclarativeFixtures(pack, syntheticFixtureRunner),
    ).resolves.toEqual({
      passed: true,
      fixtures: [
        {
          id: "fixture",
          tool: "example.read",
          status: "passed",
        },
      ],
    });
  });

  it("fails closed for ambiguous single scopes", async () => {
    const pack = await preparePackSource(
      source({
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: { label: { type: "string" } },
        },
        availability: { kind: "selector", tag: "li" },
        scope: {
          kind: "single",
          locator: { kind: "selector", tag: "li" },
        },
        projection: {
          kind: "object",
          fields: [{ key: "label", value: { kind: "text" } }],
        },
        document: {
          url: "https://example.test/",
          root: {
            tag: "ul",
            children: [
              { tag: "li", text: "private-one" },
              { tag: "li", text: "private-two" },
            ],
          },
        },
        result: { label: "private-one" },
      }),
    );

    await expect(
      verifyDeclarativeFixtures(pack, syntheticFixtureRunner),
    ).resolves.toMatchObject({
      passed: false,
      fixtures: [{ status: "failed", code: "EXECUTION_FAILED" }],
    });
  });

  it("uses strict scalar parsing instead of JavaScript coercion", async () => {
    const pack = await preparePackSource(
      source({
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: { value: { type: "number" } },
        },
        availability: { kind: "role", role: "heading" },
        scope: {
          kind: "single",
          locator: { kind: "role", role: "heading" },
        },
        projection: {
          kind: "object",
          fields: [
            {
              key: "value",
              value: {
                kind: "number",
                source: { kind: "text" },
              },
            },
          ],
        },
        document: {
          url: "https://example.test/",
          root: { tag: "h1", role: "heading", text: "1e2" },
        },
        result: { value: 100 },
      }),
    );

    await expect(
      verifyDeclarativeFixtures(pack, syntheticFixtureRunner),
    ).resolves.toMatchObject({
      passed: false,
      fixtures: [{ status: "failed", code: "EXECUTION_FAILED" }],
    });
  });
});

interface FixtureSource {
  readonly outputSchema: unknown;
  readonly availability: unknown;
  readonly scope: unknown;
  readonly projection: unknown;
  readonly document: unknown;
  readonly result: unknown;
}

function source(fixture: FixtureSource): string {
  return JSON.stringify({
    sourceVersion: 1,
    publisher: "example",
    id: "fixture-pack",
    name: "Fixture pack",
    description: "Synthetic runner fixture",
    version: "0.1.0",
    compatibility: {
      runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
      bridgeProtocol: {
        minimum: PROTOCOL_VERSION,
        maximum: PROTOCOL_VERSION,
      },
    },
    matches: [
      {
        origin: "https://example.test",
        paths: [{ kind: "exact", path: "/" }],
      },
    ],
    metadata: { license: "MIT" },
    tools: [
      {
        name: "example.read",
        description: "Read synthetic data",
        risk: "read",
        permissions: ["READ"],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        outputSchema: fixture.outputSchema,
        availability: fixture.availability,
        scope: fixture.scope,
        projection: fixture.projection,
        fixtures: [
          {
            id: "fixture",
            document: fixture.document,
            result: fixture.result,
          },
        ],
      },
    ],
  });
}

function navigationSource(): string {
  return JSON.stringify({
    sourceVersion: 1,
    publisher: "example",
    id: "navigation-pack",
    name: "Navigation pack",
    description: "Typed navigation fixture",
    version: "0.1.0",
    compatibility: {
      runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
      bridgeProtocol: {
        minimum: PROTOCOL_VERSION,
        maximum: PROTOCOL_VERSION,
      },
    },
    matches: [
      {
        origin: "https://example.test",
        paths: [{ kind: "prefix", path: "/chart/" }],
      },
    ],
    metadata: { license: "MIT" },
    tools: [
      {
        name: "example.change_symbol",
        description: "Open one reviewed symbol chart",
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
        navigation: {
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
          ],
        },
        fixtures: [
          {
            id: "change-symbol",
            currentUrl: "https://example.test/chart/OLD",
            input: { symbol: "NASDAQ:AAPL", market: "US" },
            expectedUrl: "https://example.test/chart/NASDAQ%3AAAPL?market=US",
          },
        ],
      },
    ],
  });
}
