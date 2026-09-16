import type { ValidationIssue } from "./error.js";
import { isRecord, issue } from "./primitives.js";

const MAX_JSON_DEPTH = 128;
const MAX_JSON_NODES = 100_000;
const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 4_096;
const MAX_SCHEMA_KEYWORDS = 128;
/**
 * Keywords the extension's codegen-free interpreter understands. The bridge
 * protocol enforces the same allowlist so neither side ever compiles a keyword
 * the other would refuse.
 */
const RUNTIME_SCHEMA_KEYWORDS = new Set([
  "additionalProperties",
  "const",
  "enum",
  "items",
  "maximum",
  "maxItems",
  "maxLength",
  "maxProperties",
  "minimum",
  "minItems",
  "minLength",
  "minProperties",
  "properties",
  "required",
  "type",
]);
const JSON_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

/**
 * Validates a capability schema against the runtime keyword allowlist,
 * reporting the first unsupported keyword or malformed subschema at its exact
 * path, for example `capabilities[0].inputSchema.properties.q.pattern`.
 */
export function validateRuntimeSchema(
  value: unknown,
  field: string,
  requireObjectType = false,
): ValidationIssue | undefined {
  if (!isRecord(value)) return issue("INVALID_TYPE", field);
  if (requireObjectType && value.type !== "object") {
    return issue("INVALID_SCHEMA", field);
  }
  return visitSchema(value, field, 0, { nodes: 0 });
}

function visitSchema(
  schema: Record<string, unknown>,
  field: string,
  depth: number,
  state: { nodes: number },
): ValidationIssue | undefined {
  state.nodes += 1;
  if (depth > MAX_SCHEMA_DEPTH || state.nodes > MAX_SCHEMA_NODES) {
    return issue("LIMIT_EXCEEDED", field);
  }
  const keys = Reflect.ownKeys(schema);
  if (keys.length > MAX_SCHEMA_KEYWORDS) return issue("LIMIT_EXCEEDED", field);
  for (const key of keys) {
    if (typeof key !== "string") return issue("INVALID_VALUE", field);
    if (!RUNTIME_SCHEMA_KEYWORDS.has(key)) {
      return issue("INVALID_SCHEMA", `${field}.${key}`);
    }
    const valueIssue = validateJsonValue(schema[key], `${field}.${key}`);
    if (valueIssue !== undefined) return valueIssue;
  }
  if (
    Object.hasOwn(schema, "type") &&
    (typeof schema.type !== "string" || !JSON_TYPES.has(schema.type))
  ) {
    return issue("INVALID_SCHEMA", `${field}.type`);
  }
  // Depth counts JSON nesting, the same unit the bridge's routing compiler
  // bounds: a property subschema sits two levels down (`properties` → name),
  // `items` and a schema-valued `additionalProperties` one.
  if (Object.hasOwn(schema, "properties")) {
    const propertiesField = `${field}.properties`;
    const properties = schema.properties;
    if (!isRecord(properties)) return issue("INVALID_SCHEMA", propertiesField);
    for (const name of Object.keys(properties)) {
      const nested = visitSubschema(
        properties[name],
        `${propertiesField}.${name}`,
        depth + 2,
        state,
      );
      if (nested !== undefined) return nested;
    }
  }
  if (Object.hasOwn(schema, "items")) {
    const nested = visitSubschema(
      schema.items,
      `${field}.items`,
      depth + 1,
      state,
    );
    if (nested !== undefined) return nested;
  }
  if (
    Object.hasOwn(schema, "additionalProperties") &&
    typeof schema.additionalProperties !== "boolean"
  ) {
    return visitSubschema(
      schema.additionalProperties,
      `${field}.additionalProperties`,
      depth + 1,
      state,
    );
  }
  return undefined;
}

function visitSubschema(
  candidate: unknown,
  field: string,
  depth: number,
  state: { nodes: number },
): ValidationIssue | undefined {
  if (!isRecord(candidate)) return issue("INVALID_SCHEMA", field);
  return visitSchema(candidate, field, depth, state);
}

export function validateJsonObject(
  value: unknown,
  field: string,
  requireObjectType = false,
): ValidationIssue | undefined {
  if (!isRecord(value)) return issue("INVALID_TYPE", field);
  if (Object.keys(value).length > 128) {
    return issue("LIMIT_EXCEEDED", field);
  }
  if (requireObjectType && value.type !== "object") {
    return issue("INVALID_SCHEMA", field);
  }
  return validateJsonValue(value, field);
}

export function validateJsonValue(
  value: unknown,
  field: string,
): ValidationIssue | undefined {
  const path = new WeakSet<object>();
  const state = { nodes: 0 };
  return visitJsonValue(value, field, 0, path, state);
}

function visitJsonValue(
  value: unknown,
  field: string,
  depth: number,
  path: WeakSet<object>,
  state: { nodes: number },
): ValidationIssue | undefined {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    return issue("LIMIT_EXCEEDED", field);
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : issue("INVALID_VALUE", field);
  }
  if (typeof value !== "object") return issue("INVALID_TYPE", field);
  if (path.has(value)) return issue("INVALID_VALUE", field);

  path.add(value);
  const values = Array.isArray(value)
    ? arrayValues(value, field)
    : objectValues(value, field);
  if (!Array.isArray(values)) {
    path.delete(value);
    return values;
  }
  for (const nested of values) {
    const nestedIssue = visitJsonValue(nested, field, depth + 1, path, state);
    if (nestedIssue !== undefined) {
      path.delete(value);
      return nestedIssue;
    }
  }
  path.delete(value);
  return undefined;
}

function arrayValues(
  value: unknown[],
  field: string,
): unknown[] | ValidationIssue {
  const keys = Object.keys(value);
  if (
    keys.length !== value.length ||
    keys.some((key, index) => key !== String(index))
  ) {
    return issue("INVALID_VALUE", field);
  }
  return value;
}

function objectValues(
  value: object,
  field: string,
): unknown[] | ValidationIssue {
  if (!isRecord(value)) return issue("INVALID_TYPE", field);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    return issue("INVALID_VALUE", field);
  }
  return (keys as string[]).map((key) => value[key]);
}
