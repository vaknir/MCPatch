import type { JsonObject } from "@mcpatch/sdk/runtime";
import { describe, expect, it } from "vitest";

import {
  matchesRuntimeSchema,
  supportsRuntimeSchema,
} from "../src/runtime-schema.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    labels: {
      type: "array",
      maxItems: 2,
      items: { type: "string", minLength: 1 },
    },
  },
  required: ["enabled", "labels"],
} as const satisfies JsonObject;

describe("MV3 runtime schema subset", () => {
  it("validates nested bounded JSON without dynamic code generation", () => {
    expect(supportsRuntimeSchema(schema)).toBe(true);
    expect(
      matchesRuntimeSchema(schema, { enabled: true, labels: ["a", "b"] }),
    ).toBe(true);
    expect(
      matchesRuntimeSchema(schema, { enabled: true, labels: ["", "b"] }),
    ).toBe(false);
    expect(
      matchesRuntimeSchema(schema, {
        enabled: true,
        labels: ["a", "b", "c"],
      }),
    ).toBe(false);
    expect(
      matchesRuntimeSchema(schema, {
        enabled: true,
        labels: ["a"],
        extra: true,
      }),
    ).toBe(false);
  });

  it.each(["$ref", "pattern", "oneOf"])(
    "rejects unsupported %s instead of ignoring it",
    (keyword) => {
      expect(
        supportsRuntimeSchema({
          type: "object",
          additionalProperties: false,
          properties: {},
          [keyword]: keyword === "$ref" ? "https://example.com/schema" : [],
        }),
      ).toBe(false);
    },
  );

  it("rejects accessors without invoking them", () => {
    let accessed = false;
    const value = { enabled: true, labels: ["safe"] };
    Object.defineProperty(value, "enabled", {
      enumerable: true,
      get() {
        accessed = true;
        return true;
      },
    });

    expect(matchesRuntimeSchema(schema, value)).toBe(false);
    expect(accessed).toBe(false);
  });

  it("rejects schema-array accessors without invoking them", () => {
    let accessed = false;
    const values: unknown[] = [];
    Object.defineProperty(values, 0, {
      enumerable: true,
      get() {
        accessed = true;
        return "unsafe";
      },
    });
    const candidate = { type: "string", enum: values } as JsonObject;

    expect(supportsRuntimeSchema(candidate)).toBe(false);
    expect(accessed).toBe(false);
  });

  it("rejects sparse arrays because they are not exact JSON values", () => {
    const sparse = new Array(1);

    expect(matchesRuntimeSchema({ type: "array" }, sparse)).toBe(false);
  });
});
