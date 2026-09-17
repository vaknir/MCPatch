import { describe, expect, it } from "vitest";

import { closedSchemaIssue } from "../src/validation/closed-schema.js";

const FIELD = "tools[0].outputSchema";

describe("closed JSON Schema validation", () => {
  it.each([
    ["an empty closed object", { type: "object", additionalProperties: false }],
    [
      "typed properties",
      {
        type: "object",
        additionalProperties: false,
        required: ["status", "count"],
        properties: {
          status: { type: "string", const: "ready" },
          count: { type: "integer", minimum: 0 },
          mode: { enum: ["fast", "slow"] },
          nothing: { type: "null" },
        },
      },
    ],
    [
      "closed nested objects and bounded arrays",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          rows: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              properties: { label: { type: "string", maxLength: 64 } },
            },
          },
        },
      },
    ],
    [
      "a closed map through a schema-valued additionalProperties",
      {
        type: "object",
        additionalProperties: { type: "number" },
      },
    ],
    [
      "conjunctive applicators that only narrow",
      {
        type: "object",
        additionalProperties: false,
        properties: { value: { type: "string" } },
        allOf: [{ required: ["value"] }],
      },
    ],
  ])("accepts %s", (_label, schema) => {
    expect(closedSchemaIssue(schema, FIELD)).toBeUndefined();
  });

  it.each([
    ["a non-object value", "closed", FIELD],
    ["an array", [], FIELD],
    [
      "an object with a custom prototype",
      Object.create({ type: "object", additionalProperties: false }) as unknown,
      FIELD,
    ],
    ["an empty schema", {}, FIELD],
    ["a non-object root type", { type: "string" }, FIELD],
    ["a union root type", { type: ["object", "null"] }, FIELD],
    ["a root without additionalProperties", { type: "object" }, FIELD],
    [
      "a root with additionalProperties true",
      { type: "object", additionalProperties: true },
      FIELD,
    ],
    [
      "a rejecting root",
      { type: "object", additionalProperties: false, not: {} },
      `${FIELD}.not`,
    ],
    [
      "an untyped property",
      { type: "object", additionalProperties: false, properties: { a: {} } },
      `${FIELD}.properties.a`,
    ],
    [
      "a property that is not a schema",
      {
        type: "object",
        additionalProperties: false,
        properties: { a: "string" },
      },
      `${FIELD}.properties.a`,
    ],
    [
      "an open nested object",
      {
        type: "object",
        additionalProperties: false,
        properties: { meta: { type: "object" } },
      },
      `${FIELD}.properties.meta`,
    ],
    [
      "an open nested object inside an array",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          rows: { type: "array", items: { type: "object" } },
        },
      },
      `${FIELD}.properties.rows.items`,
    ],
    [
      "an array without items",
      {
        type: "object",
        additionalProperties: false,
        properties: { rows: { type: "array", maxItems: 4 } },
      },
      `${FIELD}.properties.rows`,
    ],
    [
      "an open schema-valued additionalProperties",
      { type: "object", additionalProperties: { type: "object" } },
      `${FIELD}.additionalProperties`,
    ],
    [
      "a rejecting nested schema",
      {
        type: "object",
        additionalProperties: false,
        properties: { a: { type: "string", not: { const: "x" } } },
      },
      `${FIELD}.properties.a.not`,
    ],
    [
      "a properties value that is not a record",
      { type: "object", additionalProperties: false, properties: [] },
      `${FIELD}.properties`,
    ],
  ])("rejects %s", (_label, schema, field) => {
    expect(closedSchemaIssue(schema, FIELD)).toEqual({
      code: "INVALID_SCHEMA",
      field,
    });
  });

  it("rejects schemas nested beyond the depth budget at the offending field", () => {
    let leaf: Record<string, unknown> = { type: "string" };
    let field = FIELD;
    for (let level = 0; level < 40; level += 1) {
      leaf = {
        type: "object",
        additionalProperties: false,
        properties: { next: leaf },
      };
    }
    for (let level = 0; level < 32; level += 1) field += ".properties.next";
    const issue = closedSchemaIssue(leaf, FIELD);
    expect(issue?.code).toBe("INVALID_SCHEMA");
    expect(issue?.field.startsWith(FIELD)).toBe(true);
    expect(issue?.field.length).toBeLessThanOrEqual(field.length);
  });

  it("rejects schemas wider than the node budget", () => {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < 9_000; index += 1) {
      properties[`p${String(index)}`] = { type: "string" };
    }
    expect(
      closedSchemaIssue(
        { type: "object", additionalProperties: false, properties },
        FIELD,
      )?.code,
    ).toBe("INVALID_SCHEMA");
  });

  it("does not read accessor properties on the candidate schema", () => {
    let reads = 0;
    const schema = { type: "object", additionalProperties: false };
    Object.defineProperty(schema, "properties", {
      enumerable: true,
      get() {
        reads += 1;
        return { a: { type: "string" } };
      },
    });
    expect(closedSchemaIssue(schema, FIELD)).toEqual({
      code: "INVALID_SCHEMA",
      field: FIELD,
    });
    expect(reads).toBe(0);
  });
});
