import {
  canonicalizeOrThrow,
  encodeUtf8,
} from "./declarative-bundle-canonical.js";
import {
  MAX_ATTRIBUTE_CHARS,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_NODES,
  MAX_TEXT_CHARS,
} from "./declarative-operations-limits.js";
import type {
  DeclarativeOperationsValidationIssue,
  DeclarativeProjection,
} from "./declarative-operations-types.js";
import { isRecord } from "./validation/primitives.js";
import { operationIssue } from "./declarative-operations-validation-support.js";

const JSON_TYPES = new Set([
  "array",
  "boolean",
  "null",
  "number",
  "object",
  "string",
]);
const SUPPORTED_SCHEMA_FIELDS = new Set([
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
const SAFE_INTEGER_MIN = Number.MIN_SAFE_INTEGER;
const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

/**
 * This is intentionally smaller than JSON Schema. If a keyword can constrain a
 * dynamic page value and the interpreter cannot prove it, v1 rejects it.
 */
export function validateOutputSchema(
  projection: DeclarativeProjection,
  scope: unknown,
  schema: Record<string, unknown>,
  prefix: string,
): DeclarativeOperationsValidationIssue | undefined {
  const boundsIssue = validateProjectionOutputBounds(projection, prefix);
  if (boundsIssue !== undefined) return boundsIssue;
  if (!supportedSchema(schema)) {
    return operationIssue("INVALID_SCHEMA", `${prefix}.outputSchema`);
  }
  return outputSchemaAcceptsScopeProjection(projection, scope, schema, prefix)
    ? undefined
    : operationIssue("INVALID_SCHEMA", `${prefix}.outputSchema`);
}

function validateProjectionOutputBounds(
  projection: DeclarativeProjection,
  prefix: string,
): DeclarativeOperationsValidationIssue | undefined {
  const stack: unknown[] = [projection];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_OUTPUT_NODES)
      return operationIssue("LIMIT_EXCEEDED", prefix);
    if (Array.isArray(current)) stack.push(...current);
    else if (isRecord(current)) stack.push(...Object.values(current));
  }
  try {
    return encodeUtf8(canonicalizeOrThrow(projection)).byteLength <=
      MAX_OUTPUT_BYTES
      ? undefined
      : operationIssue("LIMIT_EXCEEDED", prefix);
  } catch {
    return operationIssue("INVALID_VALUE", prefix);
  }
}

function outputSchemaAcceptsScopeProjection(
  projection: DeclarativeProjection,
  scope: unknown,
  schema: Record<string, unknown>,
  prefix: string,
): boolean {
  if (!scopeIsList(scope))
    return outputSchemaAcceptsProjection(projection, schema, prefix);
  if (!schemaAllowsType(schema, "array")) return false;
  if (numberAbove(schema.minItems, 0)) return false;
  if (numberBelow(schema.maxItems, scope.maxMatches)) return false;
  return schema.items === undefined
    ? true
    : outputSchemaAcceptsProjection(projection, schema.items, prefix);
}

function outputSchemaAcceptsProjection(
  projection: DeclarativeProjection,
  schema: unknown,
  prefix: string,
): boolean {
  if (!isRecord(schema) || !supportedSchema(schema)) return false;
  const acceptedTypes = schemaTypes(schema.type);
  const projectionType = projectionOutputType(projection);
  if (acceptedTypes.length > 0 && !acceptedTypes.includes(projectionType))
    return false;

  if (hasSchemaSet(schema)) {
    if (projection.kind === "optional") return false;
    if (
      projection.kind !== "constant" ||
      !schemaSetContains(schema, projection.value)
    )
      return false;
  }
  if (projection.kind === "optional") {
    if (acceptedTypes.length > 0 && !acceptedTypes.includes("null"))
      return false;
    return outputSchemaAcceptsProjection(projection.value, schema, prefix);
  }
  if (projection.kind === "text") {
    return dynamicStringFits(schema, MAX_TEXT_CHARS);
  }
  if (projection.kind === "attribute") {
    return dynamicStringFits(schema, MAX_ATTRIBUTE_CHARS);
  }
  if (projection.kind === "number") {
    return dynamicNumberFits(schema, SAFE_INTEGER_MIN, SAFE_INTEGER_MAX);
  }
  if (projection.kind === "percentage") {
    return dynamicNumberFits(schema, 0, 100);
  }
  if (projection.kind === "boolean") return true;
  if (projection.kind === "constant")
    return constantFitsSchema(projection.value, schema);
  if (projection.kind === "object")
    return objectProjectionFits(projection, schema, prefix);
  if (projection.kind === "array")
    return arrayProjectionFits(projection.items, schema, prefix);
  if (projection.kind === "descendant") {
    if (projection.scope.kind === "list") {
      if (!schemaAllowsType(schema, "array")) return false;
      if (numberAbove(schema.minItems, 0)) return false;
      if (
        typeof projection.scope.maxMatches !== "number" ||
        numberBelow(schema.maxItems, projection.scope.maxMatches)
      )
        return false;
      return schema.items === undefined
        ? true
        : outputSchemaAcceptsProjection(
            projection.projection,
            schema.items,
            prefix,
          );
    }
    return outputSchemaAcceptsProjection(projection.projection, schema, prefix);
  }
  return false;
}

function dynamicStringFits(
  schema: Record<string, unknown>,
  maximum: number,
): boolean {
  if (!schemaAllowsType(schema, "string")) return false;
  if (numberAbove(schema.minLength, 0)) return false;
  return !numberBelow(schema.maxLength, maximum);
}

function dynamicNumberFits(
  schema: Record<string, unknown>,
  minimum: number,
  maximum: number,
): boolean {
  if (!schemaAllowsType(schema, "number")) return false;
  return (
    !numberAbove(schema.minimum, minimum) &&
    !numberBelow(schema.maximum, maximum)
  );
}

function objectProjectionFits(
  projection: Extract<DeclarativeProjection, { readonly kind: "object" }>,
  schema: Record<string, unknown>,
  prefix: string,
): boolean {
  if (!schemaAllowsType(schema, "object")) return false;
  const count = projection.fields.length;
  if (
    numberAbove(schema.minProperties, count) ||
    numberBelow(schema.maxProperties, count)
  )
    return false;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const keys = new Set(projection.fields.map((field) => field.key));
  if (schema.additionalProperties === false) {
    for (const key of keys) if (!Object.hasOwn(properties, key)) return false;
  }
  if (Array.isArray(schema.required)) {
    for (const required of schema.required) {
      if (typeof required !== "string" || !keys.has(required)) return false;
    }
  }
  for (const field of projection.fields) {
    if (
      Object.hasOwn(properties, field.key) &&
      !outputSchemaAcceptsProjection(
        field.value,
        properties[field.key],
        `${prefix}.outputSchema`,
      )
    )
      return false;
  }
  return true;
}

function arrayProjectionFits(
  items: readonly DeclarativeProjection[],
  schema: Record<string, unknown>,
  prefix: string,
): boolean {
  if (!schemaAllowsType(schema, "array")) return false;
  if (
    numberAbove(schema.minItems, items.length) ||
    numberBelow(schema.maxItems, items.length)
  )
    return false;
  return schema.items === undefined
    ? true
    : items.every((item) =>
        outputSchemaAcceptsProjection(item, schema.items, prefix),
      );
}

function constantFitsSchema(
  value: unknown,
  schema: Record<string, unknown>,
): boolean {
  if (!schemaAllowsValueType(schema, jsonType(value))) return false;
  if (hasSchemaSet(schema) && !schemaSetContains(schema, value)) return false;
  if (typeof value === "string") {
    return (
      !numberAbove(schema.minLength, Array.from(value).length) &&
      !numberBelow(schema.maxLength, Array.from(value).length)
    );
  }
  if (typeof value === "number") {
    return (
      !numberAbove(schema.minimum, value) && !numberBelow(schema.maximum, value)
    );
  }
  if (Array.isArray(value)) {
    if (
      numberAbove(schema.minItems, value.length) ||
      numberBelow(schema.maxItems, value.length)
    )
      return false;
    return (
      schema.items === undefined ||
      value.every(
        (item) =>
          isRecord(schema.items) && constantFitsSchema(item, schema.items),
      )
    );
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (
      numberAbove(schema.minProperties, keys.length) ||
      numberBelow(schema.maxProperties, keys.length)
    )
      return false;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (schema.additionalProperties === false) {
      for (const key of keys) if (!Object.hasOwn(properties, key)) return false;
    }
    if (Array.isArray(schema.required)) {
      for (const required of schema.required)
        if (typeof required !== "string" || !Object.hasOwn(value, required))
          return false;
    }
    return keys.every(
      (key) =>
        !Object.hasOwn(properties, key) ||
        constantFitsSchema(
          value[key],
          properties[key] as Record<string, unknown>,
        ),
    );
  }
  return true;
}

function supportedSchema(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !SUPPORTED_SCHEMA_FIELDS.has(key)))
    return false;
  const types = schemaTypes(value.type);
  if (Object.hasOwn(value, "type")) {
    if (typeof value.type === "string") {
      if (!JSON_TYPES.has(value.type)) return false;
    } else if (
      !Array.isArray(value.type) ||
      value.type.length === 0 ||
      value.type.some(
        (type) => typeof type !== "string" || !JSON_TYPES.has(type),
      )
    ) {
      return false;
    }
  }
  if (types.length !== new Set(types).size) return false;
  if (
    Object.hasOwn(value, "additionalProperties") &&
    typeof value.additionalProperties !== "boolean"
  )
    return false;
  if (Object.hasOwn(value, "properties")) {
    if (!isRecord(value.properties)) return false;
    if (
      !Object.values(value.properties).every((child) => supportedSchema(child))
    )
      return false;
  }
  if (Object.hasOwn(value, "items") && !supportedSchema(value.items))
    return false;
  if (Object.hasOwn(value, "required")) {
    if (
      !Array.isArray(value.required) ||
      new Set(value.required).size !== value.required.length ||
      value.required.some((key) => typeof key !== "string")
    )
      return false;
  }
  if (
    Object.hasOwn(value, "enum") &&
    (!Array.isArray(value.enum) || value.enum.length === 0)
  )
    return false;
  for (const key of [
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minProperties",
    "maxProperties",
    "minimum",
    "maximum",
  ]) {
    if (Object.hasOwn(value, key) && !Number.isSafeInteger(value[key]))
      return false;
  }
  for (const key of [
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minProperties",
    "maxProperties",
  ]) {
    if (
      Object.hasOwn(value, key) &&
      typeof value[key] === "number" &&
      value[key] < 0
    )
      return false;
  }
  return (
    !numberOrderInvalid(value.minItems, value.maxItems) &&
    !numberOrderInvalid(value.minLength, value.maxLength) &&
    !numberOrderInvalid(value.minProperties, value.maxProperties) &&
    !numberOrderInvalid(value.minimum, value.maximum)
  );
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function schemaAllowsType(
  schema: Record<string, unknown>,
  type: string,
): boolean {
  const types = schemaTypes(schema.type);
  return types.length === 0 || types.includes(type);
}

function schemaAllowsValueType(
  schema: Record<string, unknown>,
  type: string,
): boolean {
  return schemaAllowsType(schema, type);
}

function hasSchemaSet(schema: Record<string, unknown>): boolean {
  return Object.hasOwn(schema, "const") || Object.hasOwn(schema, "enum");
}

function schemaSetContains(
  schema: Record<string, unknown>,
  value: unknown,
): boolean {
  if (Object.hasOwn(schema, "const") && !jsonEqual(schema.const, value))
    return false;
  return (
    !Array.isArray(schema.enum) ||
    schema.enum.some((candidate) => jsonEqual(candidate, value))
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeOrThrow(left) === canonicalizeOrThrow(right);
  } catch {
    return false;
  }
}

function projectionOutputType(projection: DeclarativeProjection): string {
  switch (projection.kind) {
    case "text":
    case "attribute":
      return "string";
    case "number":
    case "percentage":
      return "number";
    case "boolean":
      return "boolean";
    case "constant":
      return jsonType(projection.value);
    case "optional":
      return projectionOutputType(projection.value);
    case "object":
      return "object";
    case "array":
      return "array";
    case "descendant":
      return projection.scope.kind === "list"
        ? "array"
        : projectionOutputType(projection.projection);
  }
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

function scopeIsList(
  value: unknown,
): value is { readonly kind: "list"; readonly maxMatches: number } {
  return (
    isRecord(value) &&
    value.kind === "list" &&
    typeof value.maxMatches === "number"
  );
}

function numberAbove(value: unknown, boundary: number): boolean {
  return typeof value === "number" && value > boundary;
}

function numberBelow(value: unknown, boundary: number): boolean {
  return typeof value === "number" && value < boundary;
}

function numberOrderInvalid(minimum: unknown, maximum: unknown): boolean {
  return (
    typeof minimum === "number" &&
    typeof maximum === "number" &&
    minimum > maximum
  );
}
