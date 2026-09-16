import { describe, expect, it } from "vitest";

import {
  buildDeclarativePack,
  defineReadTool,
  locator,
  projection,
  scope,
  syntheticDocument,
  type DeclarativeReadToolDefinition,
} from "../src/declarative.js";
import {
  computeDeclarativePackBundleDigest,
  DeclarativePackBundleValidationError,
} from "../src/index.js";

const emptyInput = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

const compatibility = {
  runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
  bridgeProtocol: { minimum: 1, maximum: 1 },
} as const;

function titleTool() {
  const heading = locator.role("heading", { name: "Page title" });
  return defineReadTool({
    name: "example.page_title",
    description: "Read the page title",
    risk: "read",
    permissions: ["READ"],
    inputSchema: emptyInput,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: { title: { type: "string" } },
    },
    availability: heading,
    scope: scope.single(heading),
    projection: projection.object({ title: projection.text() }),
    fixtures: [
      {
        id: "title",
        document: syntheticDocument({
          url: "https://example.test/article",
          root: {
            tag: "main",
            children: [
              {
                tag: "h1",
                role: "heading",
                accessibleName: "Page title",
                text: "A small page",
              },
            ],
          },
        }),
        result: { title: "A small page" },
      },
    ],
  });
}

async function build(
  tools: readonly DeclarativeReadToolDefinition[] = [titleTool()],
) {
  return buildDeclarativePack({
    publisher: "example",
    id: "unknown-site",
    name: "Unknown site",
    description: "Read a small unknown site",
    version: "0.1.0",
    compatibility,
    matches: [
      {
        origin: "https://example.test",
        paths: [{ kind: "prefix", path: "/" }],
        wholeOrigin: true,
      },
    ],
    metadata: { license: "MIT", homepage: "https://example.test/pack" },
    tools,
  });
}

describe("declarative authoring", () => {
  it("builds deterministic validated deeply frozen artifacts", async () => {
    const first = await build();
    const second = await build();

    expect(first.buildInput).toBe(second.buildInput);
    expect(first.manifest.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    await expect(
      computeDeclarativePackBundleDigest(first.bundleContent),
    ).resolves.toBe(first.manifest.digest);
    expect(first.program.operations).toHaveLength(1);
    expect(first.fixtures).toHaveLength(1);
    expect(JSON.parse(first.buildInput)).toEqual(first.bundleContent);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.manifest.tools[0]?.outputSchema)).toBe(true);
    expect(Object.isFrozen(first.fixtures[0]?.document.root.children)).toBe(
      true,
    );
  });

  it("snapshots caller-owned data before asynchronous digesting", async () => {
    const matches = [
      {
        origin: "https://example.test",
        paths: [{ kind: "prefix" as const, path: "/" }],
        wholeOrigin: true as const,
      },
    ];
    const metadata = { license: "MIT" };
    const pending = buildDeclarativePack({
      publisher: "example",
      id: "snapshot",
      name: "Snapshot",
      description: "Immutable digest input",
      version: "0.1.0",
      compatibility,
      matches,
      metadata,
      tools: [titleTool()],
    });

    const firstMatch = matches[0];
    const firstPath = firstMatch?.paths[0];
    if (firstPath === undefined) throw new Error("match fixture missing");
    firstPath.path = "/changed";
    metadata.license = "Apache-2.0";

    const result = await pending;
    expect(result.manifest.matches[0]?.paths[0]).toEqual({
      kind: "prefix",
      path: "/",
    });
    expect(result.bundleContent.metadata.license).toBe("MIT");
    await expect(
      computeDeclarativePackBundleDigest(result.bundleContent),
    ).resolves.toBe(result.manifest.digest);
  });

  it("supports a bounded list with concise projection builders", async () => {
    const row = locator.selector({ tag: "li", classes: ["result"] });
    const tool = defineReadTool({
      name: "example.results",
      description: "Read bounded result labels",
      risk: "read",
      permissions: ["READ"],
      inputSchema: emptyInput,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["results"],
        properties: {
          results: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
          },
        },
      },
      availability: locator.role("list"),
      scope: scope.single(locator.role("list")),
      projection: projection.object({
        results: projection.descendant(
          scope.list(row, { maxMatches: 5 }),
          projection.text(),
        ),
      }),
      fixtures: [
        {
          id: "results",
          document: syntheticDocument({
            url: "https://example.test/results",
            root: {
              tag: "ul",
              role: "list",
              children: [{ tag: "li", classes: ["result"], text: "One" }],
            },
          }),
          result: { results: ["One"] },
        },
      ],
    });
    const result = await build([tool] as const);
    expect(result.program.operations[0]?.projection).toMatchObject({
      kind: "object",
      fields: [
        {
          key: "results",
          value: {
            kind: "descendant",
            scope: { kind: "list", maxMatches: 5 },
          },
        },
      ],
    });
  });

  it("rejects raw builder lookalikes and canonical validator failures", async () => {
    expect(() =>
      defineReadTool({
        name: "example.raw",
        description: "Reject raw nodes",
        risk: "read",
        permissions: ["READ"],
        inputSchema: emptyInput,
        outputSchema: { type: "string" },
        availability: { kind: "role", role: "heading" } as never,
        scope: scope.single(locator.role("heading")),
        projection: projection.text(),
        fixtures: [],
      }),
    ).toThrow();

    expect(() => locator.selector({ id: "${dynamic}" })).toThrow();

    const heading = locator.role("heading");
    const mismatched = defineReadTool({
      name: "example.mismatch",
      description: "Reject schema mismatch",
      risk: "read",
      permissions: ["READ"],
      inputSchema: emptyInput,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: { value: { type: "number" } },
      },
      availability: heading,
      scope: scope.single(heading),
      projection: projection.object({ value: projection.text() }),
      fixtures: [
        {
          id: "mismatch",
          document: syntheticDocument({
            url: "https://example.test/",
            root: { tag: "h1", text: "x" },
          }),
          result: { value: 1 },
        },
      ],
    });
    await expect(build([mismatched] as const)).rejects.toBeInstanceOf(
      DeclarativePackBundleValidationError,
    );
  });

  it("rejects duplicate tools, missing fixtures, and undeclared fixture tools", async () => {
    const tool = titleTool();
    await expect(build([tool, tool] as const)).rejects.toMatchObject({
      issue: { code: "DUPLICATE_VALUE" },
    });
    expect(() =>
      defineReadTool({
        name: "example.empty",
        description: "No coverage",
        risk: "read",
        permissions: ["READ"],
        inputSchema: emptyInput,
        outputSchema: { type: "string" },
        availability: locator.role("heading"),
        scope: scope.single(locator.role("heading")),
        projection: projection.text(),
        fixtures: [],
      }),
    ).toThrow();
    const heading = locator.role("heading");
    expect(() =>
      defineReadTool({
        name: "example.foreign_fixture",
        description: "Reject a fixture-selected tool",
        risk: "read",
        permissions: ["READ"],
        inputSchema: emptyInput,
        outputSchema: { type: "string" },
        availability: heading,
        scope: scope.single(heading),
        projection: projection.text(),
        fixtures: [
          {
            id: "foreign",
            tool: "example.undeclared",
            document: syntheticDocument({
              url: "https://example.test/",
              root: { tag: "h1", text: "x" },
            }),
            result: "x",
          } as never,
        ],
      }),
    ).toThrow();
  });

  it("rejects executable fields and permission or risk mismatches", () => {
    const heading = locator.role("heading");
    const base = {
      name: "example.denied",
      description: "Rejected authority",
      risk: "read",
      permissions: ["READ"],
      inputSchema: emptyInput,
      outputSchema: { type: "string" },
      availability: heading,
      scope: scope.single(heading),
      projection: projection.text(),
      fixtures: [
        {
          id: "denied",
          document: syntheticDocument({
            url: "https://example.test/",
            root: { tag: "h1", text: "x" },
          }),
          result: "x",
        },
      ],
    } as const;
    expect(() =>
      defineReadTool({ ...base, execute: () => "x" } as never),
    ).toThrow();
    expect(() =>
      defineReadTool({ ...base, risk: "action" } as never),
    ).toThrow();
    expect(() =>
      defineReadTool({ ...base, permissions: ["ACTION"] } as never),
    ).toThrow();
  });

  it.each([
    ["function", { bad: () => undefined }],
    ["date", new Date(0)],
    ["map", new Map()],
    ["set", new Set()],
    [
      "class",
      new (class Foreign {
        readonly marker = true;
      })(),
    ],
  ])("rejects %s values", (_name, value) => {
    expect(() => projection.constant(value as never)).toThrow();
  });

  it("rejects accessors, symbols, and cycles without invoking them", () => {
    let invoked = false;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        invoked = true;
        return "secret";
      },
    });
    expect(() => projection.constant(accessor as never)).toThrow();
    expect(invoked).toBe(false);
    expect(() =>
      projection.constant({ [Symbol("x")]: true } as never),
    ).toThrow();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => projection.constant(cyclic as never)).toThrow();
  });
});
