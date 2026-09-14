import type { ValidationIssue } from "./error.js";
import { isRecord, issue } from "./primitives.js";

const MAX_JSON_DEPTH = 128;
const MAX_JSON_NODES = 100_000;

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
