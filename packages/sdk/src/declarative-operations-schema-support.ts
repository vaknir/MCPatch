import {
  canonicalizeOrThrow,
  encodeUtf8,
} from "./declarative-bundle-canonical.js";
import {
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_NODES,
} from "./declarative-operations-limits.js";
import type {
  DeclarativeOperationsValidationIssue,
  DeclarativeProjection,
} from "./declarative-operations-types.js";
import { isRecord } from "./validation/primitives.js";
import { operationIssue } from "./declarative-operations-validation-support.js";

export function validateOutputSchema(
  projection: DeclarativeProjection,
  scope: unknown,
  schema: Record<string, unknown>,
  prefix: string,
): DeclarativeOperationsValidationIssue | undefined {
  const boundsIssue = validateProjectionOutputBounds(projection, prefix);
  if (boundsIssue !== undefined) return boundsIssue;
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
  const type = schema.type;
  if (
    (typeof type === "string" && type !== "array") ||
    (Array.isArray(type) && !type.includes("array"))
  )
    return false;
  if (typeof schema.maxItems === "number" && schema.maxItems < scope.maxMatches)
    return false;
  return schema.items === undefined
    ? true
    : outputSchemaAcceptsProjection(projection, schema.items, prefix);
}

function outputSchemaAcceptsProjection(
  projection: DeclarativeProjection,
  schema: unknown,
  prefix: string,
): boolean {
  if (!isRecord(schema)) return false;
  const acceptedTypes = schemaTypes(schema.type);
  const projectionType = projectionOutputType(projection);
  if (acceptedTypes.length > 0 && !acceptedTypes.includes(projectionType))
    return false;
  if (projection.kind === "optional") {
    if (acceptedTypes.length > 0 && !acceptedTypes.includes("null"))
      return false;
    return outputSchemaAcceptsProjection(projection.value, schema, prefix);
  }
  if (
    Object.hasOwn(schema, "const") &&
    !constantProjectionEquals(projection, schema.const)
  )
    return false;
  if (Array.isArray(schema.enum)) {
    if (
      projection.kind !== "constant" ||
      !schema.enum.some(
        (candidate) =>
          JSON.stringify(candidate) === JSON.stringify(projection.value),
      )
    )
      return false;
  }
  if (projection.kind === "number" || projection.kind === "percentage") {
    if (
      typeof schema.minimum === "number" &&
      projection.kind === "percentage" &&
      schema.minimum < 0
    )
      return false;
    if (
      typeof schema.maximum === "number" &&
      projection.kind === "percentage" &&
      schema.maximum > 100
    )
      return false;
  }
  if (projection.kind === "constant")
    return constantFitsSchema(projection.value, schema);
  if (projection.kind === "object") {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const keys = new Set(projection.fields.map((field) => field.key));
    if (schema.additionalProperties === false) {
      for (const key of keys) if (!Object.hasOwn(properties, key)) return false;
    }
    if (Array.isArray(schema.required)) {
      for (const required of schema.required)
        if (typeof required !== "string" || !keys.has(required)) return false;
    }
    for (const field of projection.fields) {
      if (
        Object.hasOwn(properties, field.key) &&
        !outputSchemaAcceptsProjection(
          field.value,
          properties[field.key],
          `${prefix}.${field.key}`,
        )
      )
        return false;
    }
    return true;
  }
  if (projection.kind === "array") {
    if (
      typeof schema.maxItems === "number" &&
      schema.maxItems < projection.items.length
    )
      return false;
    return (
      schema.items === undefined ||
      projection.items.every((item) =>
        outputSchemaAcceptsProjection(item, schema.items, prefix),
      )
    );
  }
  if (projection.kind === "descendant") {
    if (projection.scope.kind === "list") {
      if (
        typeof projection.scope.maxMatches !== "number" ||
        (typeof schema.maxItems === "number" &&
          schema.maxItems < projection.scope.maxMatches)
      )
        return false;
      return (
        schema.items === undefined ||
        outputSchemaAcceptsProjection(
          projection.projection,
          schema.items,
          prefix,
        )
      );
    }
    return outputSchemaAcceptsProjection(projection.projection, schema, prefix);
  }
  return true;
}

function constantFitsSchema(
  value: unknown,
  schema: Record<string, unknown>,
): boolean {
  const types = schemaTypes(schema.type);
  if (types.length > 0 && !types.includes(jsonType(value))) return false;
  if (
    typeof value === "string" &&
    typeof schema.maxLength === "number" &&
    Array.from(value).length > schema.maxLength
  )
    return false;
  if (
    Array.isArray(value) &&
    typeof schema.maxItems === "number" &&
    value.length > schema.maxItems
  )
    return false;
  if (
    isRecord(value) &&
    schema.additionalProperties === false &&
    isRecord(schema.properties)
  ) {
    for (const key of Object.keys(value))
      if (!Object.hasOwn(schema.properties, key)) return false;
  }
  return true;
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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

function constantProjectionEquals(
  projection: DeclarativeProjection,
  value: unknown,
): boolean {
  return (
    projection.kind === "constant" &&
    JSON.stringify(projection.value) === JSON.stringify(value)
  );
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
