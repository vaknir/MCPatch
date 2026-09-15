import type { JsonObject, JsonValue } from "@mcpatch/sdk/runtime";

import { supportsRuntimeSchema } from "./runtime-schema-support.js";

export { supportsRuntimeSchema } from "./runtime-schema-support.js";

const MAX_DEPTH = 32;
const MAX_NODES = 8_192;

/** Validates one bounded JSON value with the supported, codegen-free subset. */
export function matchesRuntimeSchema(
  schema: JsonObject,
  value: unknown,
): boolean {
  if (!supportsRuntimeSchema(schema)) return false;
  const budget = { nodes: 0 };
  return matches(schema, value, 0, budget);
}

function matches(
  schema: JsonObject,
  value: unknown,
  depth: number,
  budget: { nodes: number },
): boolean {
  budget.nodes += 1;
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) return false;
  if (!matchesType(schema.type, value)) return false;
  if (Object.hasOwn(schema, "const") && !jsonEqual(schema.const, value)) {
    return false;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => jsonEqual(candidate, value))
  ) {
    return false;
  }
  if (typeof value === "string" && !matchesStringBounds(schema, value)) {
    return false;
  }
  if (typeof value === "number" && !matchesNumberBounds(schema, value)) {
    return false;
  }
  if (Array.isArray(value)) return matchesArray(schema, value, depth, budget);
  if (isDataRecord(value)) return matchesObject(schema, value, depth, budget);
  return isJsonPrimitive(value);
}

function matchesObject(
  schema: JsonObject,
  value: Record<string, unknown>,
  depth: number,
  budget: { nodes: number },
): boolean {
  const keys = Object.keys(value);
  if (!withinBounds(keys.length, schema.minProperties, schema.maxProperties)) {
    return false;
  }
  const required = schema.required;
  if (
    Array.isArray(required) &&
    required.some(
      (key) => typeof key !== "string" || !Object.hasOwn(value, key),
    )
  ) {
    return false;
  }
  const properties = isDataRecord(schema.properties)
    ? schema.properties
    : Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
    const childSchema = properties[key];
    if (isDataRecord(childSchema)) {
      if (
        !matches(childSchema as JsonObject, descriptor.value, depth + 1, budget)
      ) {
        return false;
      }
      continue;
    }
    if (schema.additionalProperties === false) return false;
    if (
      isDataRecord(schema.additionalProperties) &&
      !matches(
        schema.additionalProperties as JsonObject,
        descriptor.value,
        depth + 1,
        budget,
      )
    ) {
      return false;
    }
  }
  return true;
}

function matchesArray(
  schema: JsonObject,
  value: unknown[],
  depth: number,
  budget: { nodes: number },
): boolean {
  if (!withinBounds(value.length, schema.minItems, schema.maxItems))
    return false;
  if (!isDataRecord(schema.items)) return arrayHasOnlyData(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !matches(schema.items as JsonObject, descriptor.value, depth + 1, budget)
    ) {
      return false;
    }
  }
  return arrayHasOnlyData(value);
}

function matchesType(type: JsonValue | undefined, value: unknown): boolean {
  if (type === undefined) return true;
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isSafeInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isDataRecord(value);
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function matchesStringBounds(schema: JsonObject, value: string): boolean {
  return withinBounds(
    Array.from(value).length,
    schema.minLength,
    schema.maxLength,
  );
}

function matchesNumberBounds(schema: JsonObject, value: number): boolean {
  return (
    (typeof schema.minimum !== "number" || value >= schema.minimum) &&
    (typeof schema.maximum !== "number" || value <= schema.maximum)
  );
}

function withinBounds(
  value: number,
  minimum: JsonValue | undefined,
  maximum: JsonValue | undefined,
): boolean {
  return (
    (typeof minimum !== "number" || value >= minimum) &&
    (typeof maximum !== "number" || value <= maximum)
  );
}

function arrayHasOnlyData(value: unknown[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return false;
  return keys.every((key) => {
    if (key === "length") return true;
    if (typeof key !== "string") return false;
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < value.length &&
      String(index) === key &&
      descriptor !== undefined &&
      "value" in descriptor
    );
  });
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length ||
      !arrayHasOnlyData(left) ||
      !arrayHasOnlyData(right)
    ) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      const leftValue = Object.getOwnPropertyDescriptor(left, index)?.value;
      const rightValue = Object.getOwnPropertyDescriptor(right, index)?.value;
      if (!jsonEqual(leftValue, rightValue)) return false;
    }
    return true;
  }
  if (!isDataRecord(left) || !isDataRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && jsonEqual(left[key], right[key]),
    )
  );
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

function isJsonPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
