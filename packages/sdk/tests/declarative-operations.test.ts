import { readFileSync } from "node:fs";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  MAX_OPERATION_AST_NODES,
  MAX_OPERATION_LIST_ITEMS,
  MAX_OPERATION_OBJECT_FIELDS,
  MAX_OPERATIONS_PAYLOAD_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_NODES,
  MAX_PROJECTION_DEPTH,
  validateDeclarativePackBundle,
  validateDeclarativeOperations,
} from "../src/index.js";
import type { PackToolManifest } from "../src/index.js";

const validProgram = readJson("fixtures/v1/operations/valid/read.json");
const invalidCases = readJson(
  "fixtures/v1/operations/invalid/cases.json",
) as InvalidCase[];
const bundle = readJson("fixtures/v1/bundles/valid/declarative-read.mcpack");
const schema = readJson("schema/v1/declarative-pack-bundle.schema.json");
const validateBundleSchema = new Ajv2020({
  strict: true,
  validateFormats: false,
}).compile(schema as AnySchema);

describe("Declarative Operations v1 golden contract", () => {
  it("accepts the valid nested-read fixture through the bundle schema and semantic validator", () => {
    expect(
      validateBundleSchema(bundle),
      JSON.stringify(validateBundleSchema.errors),
    ).toBe(true);
    expect(
      validateDeclarativeOperations(validProgram, [
        tool({ outputSchema: { type: "object" } }),
      ]),
    ).toBeUndefined();
  });

  it.each(invalidCases)(
    "rejects $name with a stable payload-safe issue",
    (testCase) => {
      const issue = validateDeclarativeOperations(testCase.program, [
        tool({ outputSchema: { type: "object" } }),
      ]);
      expect(issue).toEqual(testCase.issue);
      const candidate = structuredClone(bundle) as Record<string, unknown>;
      candidate.operations = {
        ...(candidate.operations as Record<string, unknown>),
        program: testCase.program,
      };
      expect(validateBundleSchema(candidate)).toBe(testCase.schemaValid);
      expect(JSON.stringify(issue)).not.toContain("secret");
      expect(JSON.stringify(issue)).not.toContain("input.id");
    },
  );

  it("enforces the exact list bound and rejects N+1 against the declared output schema", () => {
    const listTool = tool({
      outputSchema: {
        type: "array",
        maxItems: MAX_OPERATION_LIST_ITEMS,
        items: { type: "string" },
      },
    });
    const accepted = program({
      scope: {
        kind: "list",
        locator: { kind: "role", role: "list" },
        maxMatches: MAX_OPERATION_LIST_ITEMS,
      },
      projection: { kind: "text" },
    });
    expect(validateDeclarativeOperations(accepted, [listTool])).toBeUndefined();
    const rejected = structuredClone(accepted) as Record<string, unknown>;
    const rejectedOperation = (
      rejected.operations as Record<string, unknown>[]
    )[0];
    if (rejectedOperation === undefined) throw new Error("operation missing");
    (rejectedOperation.scope as Record<string, unknown>).maxMatches =
      MAX_OPERATION_LIST_ITEMS + 1;
    expect(validateDeclarativeOperations(rejected, [listTool])).toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
  });

  it("enforces object fields and projection depth at exactly N/N+1", () => {
    const fields = Array.from(
      { length: MAX_OPERATION_OBJECT_FIELDS },
      (_, index) => ({ key: `field${index}`, value: { kind: "text" } }),
    );
    const accepted = program({ projection: { kind: "object", fields } });
    const objectTool = tool({ outputSchema: { type: "object" } });
    expect(
      validateDeclarativeOperations(accepted, [objectTool]),
    ).toBeUndefined();
    const rejectedFields = structuredClone(accepted) as Record<string, unknown>;
    const rejectedFieldOperation = (
      rejectedFields.operations as Record<string, unknown>[]
    )[0];
    if (rejectedFieldOperation === undefined)
      throw new Error("operation missing");
    (
      (rejectedFieldOperation.projection as Record<string, unknown>)
        .fields as unknown[]
    ).push({ key: "overflow", value: { kind: "text" } });
    expect(
      validateDeclarativeOperations(rejectedFields, [objectTool]),
    ).toMatchObject({ code: "LIMIT_EXCEEDED" });

    let shallow: unknown = { kind: "text" };
    for (let index = 1; index < MAX_PROJECTION_DEPTH; index += 1)
      shallow = { kind: "optional", value: shallow };
    expect(
      validateDeclarativeOperations(program({ projection: shallow }), [
        tool({ outputSchema: {} }),
      ]),
    ).toBeUndefined();
    const deep = { kind: "optional", value: shallow };
    expect(
      validateDeclarativeOperations(program({ projection: deep }), [
        tool({ outputSchema: {} }),
      ]),
    ).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("rejects dynamic construction, cycles, foreign prototypes, accessors, and symbols", () => {
    const foreign = Object.create({ foreign: true }) as Record<string, unknown>;
    foreign.version = 1;
    expect(
      validateDeclarativeOperations(foreign, [tool({ outputSchema: {} })]),
    ).toMatchObject({ code: "INVALID_TYPE" });
    const accessor = structuredClone(validProgram) as Record<string, unknown>;
    Object.defineProperty(accessor, "computed", {
      enumerable: true,
      get: () => "nope",
    });
    expect(
      validateDeclarativeOperations(accessor, [tool({ outputSchema: {} })]),
    ).toMatchObject({ code: "INVALID_TYPE" });
    const symbolValue = structuredClone(validProgram) as Record<
      string,
      unknown
    >;
    Object.defineProperty(symbolValue, Symbol("hidden"), {
      value: true,
      enumerable: true,
    });
    expect(
      validateDeclarativeOperations(symbolValue, [tool({ outputSchema: {} })]),
    ).toMatchObject({ code: "UNKNOWN_FIELD" });
    const cycle = structuredClone(validProgram) as Record<string, unknown>;
    (cycle.operations as unknown[]).push(cycle);
    expect(
      validateDeclarativeOperations(cycle, [tool({ outputSchema: {} })]),
    ).toMatchObject({ code: "INVALID_VALUE" });
  });

  it("requires a tool bijection independent of declaration order", () => {
    const tools = [tool(), tool({ name: "example.items.other" })];
    const operations = [
      operation("example.items.other"),
      operation("example.items.current"),
    ];
    expect(
      validateDeclarativeOperations({ version: 1, operations }, tools),
    ).toBeUndefined();
    expect(
      validateDeclarativeOperations(
        { version: 1, operations: [operations[0]] },
        tools,
      ),
    ).toMatchObject({ code: "INVALID_REFERENCE" });
    expect(
      validateDeclarativeOperations(
        {
          version: 1,
          operations: [
            operation("example.items.current"),
            operation("example.items.current"),
          ],
        },
        tools,
      ),
    ).toMatchObject({ code: "DUPLICATE_VALUE" });
    expect(
      validateDeclarativeOperations(
        {
          version: 1,
          operations: [operation("example.unknown"), operations[1]],
        },
        tools,
      ),
    ).toMatchObject({ code: "INVALID_REFERENCE" });
    expect(
      validateDeclarativeOperations({ version: 1, operations: [] }, [tool()]),
    ).toMatchObject({ code: "INVALID_REFERENCE" });
  });

  it("covers all static locator families and rejects conflicting components", () => {
    const validLocators = [
      { kind: "role", role: "button", name: "Save" },
      { kind: "selector", tag: "button" },
      { kind: "selector", id: "save" },
      { kind: "selector", classes: ["primary", "wide"] },
      {
        kind: "selector",
        attributes: [{ name: "data-testid", value: "save" }],
      },
      {
        kind: "selector",
        tag: "button",
        id: "save",
        classes: ["primary"],
        attributes: [{ name: "data-state", value: "ready" }],
      },
    ];
    for (const locator of validLocators) {
      expect(
        validateDeclarativeOperations(
          program({
            availability: { kind: "present", locator },
            scope: { kind: "single", locator },
          }),
          [tool({ outputSchema: {} })],
        ),
      ).toBeUndefined();
    }
    const invalid = [
      { kind: "role", role: "made-up" },
      { kind: "selector", css: ".button" },
      {
        kind: "selector",
        id: "save",
        attributes: [{ name: "id", value: "save" }],
      },
      { kind: "selector", classes: ["same", "same"] },
      {
        kind: "selector",
        attributes: [
          { name: "role", value: "button" },
          { name: "role", value: "button" },
        ],
      },
      { kind: "selector", attributes: [{ name: "value", value: "secret" }] },
    ];
    for (const locator of invalid) {
      expect(
        validateDeclarativeOperations(
          program({
            availability: { kind: "present", locator },
            scope: { kind: "single", locator },
          }),
          [tool({ outputSchema: {} })],
        ),
      ).toBeDefined();
    }
  });

  it("covers scalar, constant, optional, array, and nested single/list projections", () => {
    const projections = [
      { kind: "text" },
      { kind: "attribute", name: "title" },
      { kind: "constant", value: "fixed" },
      { kind: "number", source: { kind: "text" } },
      {
        kind: "percentage",
        source: { kind: "attribute", name: "aria-valuenow" },
      },
      { kind: "boolean", source: { kind: "text" } },
      { kind: "optional", value: { kind: "attribute", name: "alt" } },
      {
        kind: "array",
        items: [
          { kind: "constant", value: 1 },
          { kind: "constant", value: true },
        ],
      },
      {
        kind: "descendant",
        scope: { kind: "single", locator: { kind: "selector", tag: "span" } },
        projection: { kind: "text" },
      },
      {
        kind: "descendant",
        scope: {
          kind: "list",
          locator: { kind: "selector", tag: "span" },
          maxMatches: 2,
        },
        projection: { kind: "number", source: { kind: "text" } },
      },
    ];
    for (const projection of projections) {
      expect(
        validateDeclarativeOperations(program({ projection }), [
          tool({ outputSchema: {} }),
        ]),
      ).toBeUndefined();
    }
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "optional", value: { kind: "text" } } }),
        [tool({ outputSchema: { type: "string" } })],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "optional", value: { kind: "text" } } }),
        [tool({ outputSchema: { type: ["string", "null"] } })],
      ),
    ).toBeUndefined();
  });

  it("checks output schema type, enum/const, required/additional fields, and output bounds", () => {
    const objectProjection = {
      kind: "object",
      fields: [{ key: "name", value: { kind: "text" } }],
    };
    expect(
      validateDeclarativeOperations(program({ projection: objectProjection }), [
        tool({ outputSchema: { type: "object", required: ["missing"] } }),
      ]),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(program({ projection: objectProjection }), [
        tool({
          outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { other: { type: "string" } },
          },
        }),
      ]),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "constant", value: "a" } }),
        [tool({ outputSchema: { type: "string", const: "b" } })],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "constant", value: "a" } }),
        [tool({ outputSchema: { type: "string", enum: ["b", "c"] } })],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(program({ projection: { kind: "text" } }), [
        tool({ outputSchema: { type: "string", maxLength: 1 } }),
      ]),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(program({ projection: { kind: "text" } }), [
        tool({ outputSchema: { type: "string", pattern: "^safe$" } }),
      ]),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "number", source: { kind: "text" } } }),
        [tool({ outputSchema: { type: "number", minimum: 50 } })],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({
          projection: { kind: "percentage", source: { kind: "text" } },
        }),
        [tool({ outputSchema: { type: "number", minimum: 50 } })],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({
          projection: { kind: "percentage", source: { kind: "text" } },
        }),
        [tool({ outputSchema: { type: "number", minimum: 0, maximum: 100 } })],
      ),
    ).toBeUndefined();
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "constant", value: {} } }),
        [tool({ outputSchema: { type: "object", required: ["secret"] } })],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "constant", value: { title: "x" } } }),
        [
          tool({
            outputSchema: {
              type: "object",
              properties: { title: { type: "string", maxLength: 0 } },
            },
          }),
        ],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "optional", value: { kind: "text" } } }),
        [tool({ outputSchema: { type: ["string", "null"], const: "x" } })],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(program({ projection: { kind: "text" } }), [
        tool({ outputSchema: { anyOf: [{ type: "string" }] } }),
      ]),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    const rootList = {
      kind: "list",
      locator: { kind: "role", role: "list" },
      maxMatches: 2,
    };
    expect(
      validateDeclarativeOperations(
        program({ scope: rootList, projection: { kind: "text" } }),
        [
          tool({
            outputSchema: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              items: { type: "string" },
            },
          }),
        ],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(
        program({ scope: rootList, projection: { kind: "text" } }),
        [
          tool({
            outputSchema: {
              type: "array",
              maxItems: 1,
              items: { type: "string" },
            },
          }),
        ],
      ),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    const nestedList = {
      kind: "descendant",
      scope: {
        kind: "list",
        locator: { kind: "selector", tag: "span" },
        maxMatches: 2,
      },
      projection: { kind: "text" },
    };
    expect(
      validateDeclarativeOperations(program({ projection: nestedList }), [
        tool({
          outputSchema: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: { type: "string" },
          },
        }),
      ]),
    ).toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      validateDeclarativeOperations(program({ projection: nestedList }), [
        tool({
          outputSchema: {
            type: "array",
            maxItems: 2,
            items: { type: "string" },
          },
        }),
      ]),
    ).toBeUndefined();
    const outputNodes = Array.from({ length: MAX_OUTPUT_NODES }, () => "x");
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "constant", value: outputNodes } }),
        [tool({ outputSchema: {} })],
      ),
    ).toMatchObject({ code: "LIMIT_EXCEEDED" });
    const outputBytes = Array.from({ length: 16 }, () => "x".repeat(4_096));
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "constant", value: outputBytes } }),
        [tool({ outputSchema: {} })],
      ),
    ).toMatchObject({ code: "LIMIT_EXCEEDED" });
    const payload = Array.from({ length: 20 }, () => "x".repeat(16_000));
    expect(
      validateDeclarativeOperations(
        program({ projection: { kind: "constant", value: payload } }),
        [tool({ outputSchema: {} })],
      ),
    ).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(MAX_OUTPUT_BYTES).toBe(64 * 1024);
    expect(MAX_OPERATIONS_PAYLOAD_BYTES).toBe(256 * 1024);
    expect(MAX_OPERATION_AST_NODES).toBe(256);
  });

  it("enforces declarative read-only policy through bundle validation", () => {
    const candidate = structuredClone(bundle) as Record<string, unknown>;
    const manifest = candidate.manifest as Record<string, unknown>;
    const tools = manifest.tools as Record<string, unknown>[];
    const firstTool = tools[0];
    if (firstTool === undefined) throw new Error("tool missing");
    firstTool.inputSchema = {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
    };
    expect(validateDeclarativePackBundle(candidate)).toMatchObject({
      code: "INVALID_SCHEMA",
    });
    firstTool.inputSchema = {
      type: "object",
      additionalProperties: false,
      properties: {},
    };
    manifest.networkPolicy = {
      extensionRequests: { origins: ["https://example.com"], methods: ["GET"] },
    };
    expect(validateDeclarativePackBundle(candidate)).toMatchObject({
      code: "INVALID_PERMISSION",
      field: "manifest",
    });
  });
});

function tool(overrides: Partial<PackToolManifest> = {}): PackToolManifest {
  return {
    name: "example.items.current",
    description: "Read the current item",
    risk: "read",
    permissions: ["READ"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    outputSchema: { type: "object" },
    ...overrides,
  };
}

function program(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const operation = {
    kind: "read",
    tool: "example.items.current",
    availability: { kind: "present", locator: { kind: "role", role: "main" } },
    scope: { kind: "single", locator: { kind: "role", role: "main" } },
    projection: {
      kind: "object",
      fields: [{ key: "value", value: { kind: "text" } }],
    },
    ...overrides,
  };
  return { version: 1, operations: [operation] };
}

function operation(toolName: string): Record<string, unknown> {
  const operations = (program({}) as { operations: Record<string, unknown>[] })
    .operations;
  const result = operations[0];
  if (result === undefined) throw new Error("operation missing");
  result.tool = toolName;
  return result;
}

function readJson(path: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
  ) as unknown;
}

interface InvalidCase {
  readonly name: string;
  readonly program: unknown;
  readonly issue: { readonly code: string; readonly field: string };
  readonly schemaValid: boolean;
}
