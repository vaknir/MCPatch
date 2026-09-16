import type { JsonObject, JsonValue } from "@mcpatch/protocol";

const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 8_192;

/** Validates generated declarative output without code generation. */
export function matchesDeclarativeOutputSchema(
  schema: JsonObject,
  value: unknown,
): boolean {
  return matches(schema, value, 0, { nodes: 0 });
}

function matches(
  schema: unknown,
  value: unknown,
  depth: number,
  budget: { nodes: number },
): boolean {
  budget.nodes += 1;
  if (
    depth > MAX_SCHEMA_DEPTH ||
    budget.nodes > MAX_SCHEMA_NODES ||
    !isDataRecord(schema) ||
    !matchesType(schema.type, value)
  ) {
    return false;
  }
  if (Object.hasOwn(schema, "const") && !jsonEqual(schema.const, value)) {
    return false;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => jsonEqual(candidate, value))
  ) {
    return false;
  }
  if (typeof value === "string") {
    return withinBounds(
      Array.from(value).length,
      schema.minLength,
      schema.maxLength,
    );
  }
  if (typeof value === "number") {
    return (
      Number.isFinite(value) &&
      (typeof schema.minimum !== "number" || value >= schema.minimum) &&
      (typeof schema.maximum !== "number" || value <= schema.maximum)
    );
  }
  if (Array.isArray(value)) {
    if (!withinBounds(value.length, schema.minItems, schema.maxItems)) {
      return false;
    }
    if (!isDataRecord(schema.items)) return hasOnlyDataArrayEntries(value);
    return (
      hasOnlyDataArrayEntries(value) &&
      value.every((item) => matches(schema.items, item, depth + 1, budget))
    );
  }
  if (isDataRecord(value)) {
    return matchesObject(schema, value, depth, budget);
  }
  return value === null || typeof value === "boolean";
}

function matchesObject(
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
  depth: number,
  budget: { nodes: number },
): boolean {
  const keys = Object.keys(value);
  if (!withinBounds(keys.length, schema.minProperties, schema.maxProperties)) {
    return false;
  }
  if (
    Array.isArray(schema.required) &&
    schema.required.some(
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
      if (!matches(childSchema, descriptor.value, depth + 1, budget)) {
        return false;
      }
    } else if (schema.additionalProperties === false) {
      return false;
    }
  }
  return true;
}

function matchesType(type: unknown, value: unknown): boolean {
  if (type === undefined) return true;
  const candidates = Array.isArray(type) ? type : [type];
  return candidates.some(
    (candidate) => typeof candidate === "string" && isType(candidate, value),
  );
}

function isType(type: string, value: unknown): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
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

function withinBounds(
  value: number,
  minimum: unknown,
  maximum: unknown,
): boolean {
  return (
    (typeof minimum !== "number" || value >= minimum) &&
    (typeof maximum !== "number" || value <= maximum)
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length ||
      !hasOnlyDataArrayEntries(left) ||
      !hasOnlyDataArrayEntries(right)
    ) {
      return false;
    }
    return left.every((item, index) => jsonEqual(item, right[index]));
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

function hasOnlyDataArrayEntries(value: readonly unknown[]): boolean {
  return Reflect.ownKeys(value).every((key) => {
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

function isDataRecord(value: unknown): value is Record<string, JsonValue> {
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
