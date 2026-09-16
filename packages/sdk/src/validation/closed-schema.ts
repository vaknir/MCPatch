import type { PackManifestValidationIssue } from "../types.js";
import { isRecord, issue } from "./primitives.js";

const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 8_192;
const JSON_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

interface Budget {
  nodes: number;
}

/**
 * Reports why a tool schema is not closed, or `undefined` when every value it
 * accepts is fully described by the pack author.
 *
 * A closed schema is the only mechanism between a page and the MCP client, so
 * it must never admit unnamed content: the root is an object with
 * `additionalProperties` set to `false` or to a closed subschema, every
 * subschema declares `type`, `const`, or `enum`, nested objects are closed the
 * same way, arrays declare `items`, and `not` never appears because a schema
 * that rejects everything ships a tool that can never succeed. Applicators
 * such as `allOf` or `$ref` only narrow what a Draft 2020-12 schema accepts,
 * so they cannot reopen a closed schema and are left to runtime support checks.
 */
export function closedSchemaIssue(
  value: unknown,
  field: string,
): PackManifestValidationIssue | undefined {
  const root = dataRecord(value);
  if (root === undefined || root.type !== "object") {
    return issue("INVALID_SCHEMA", field);
  }
  return subschemaIssue(root, field, 0, { nodes: 0 });
}

function subschemaIssue(
  schema: Record<string, unknown>,
  field: string,
  depth: number,
  budget: Budget,
): PackManifestValidationIssue | undefined {
  budget.nodes += 1;
  if (depth >= MAX_SCHEMA_DEPTH || budget.nodes > MAX_SCHEMA_NODES) {
    return issue("INVALID_SCHEMA", field);
  }
  if (Object.hasOwn(schema, "not"))
    return issue("INVALID_SCHEMA", `${field}.not`);
  if (!declaresShape(schema)) return issue("INVALID_SCHEMA", field);
  if (schema.type === "object")
    return objectIssue(schema, field, depth, budget);
  if (schema.type === "array") return arrayIssue(schema, field, depth, budget);
  return undefined;
}

function objectIssue(
  schema: Record<string, unknown>,
  field: string,
  depth: number,
  budget: Budget,
): PackManifestValidationIssue | undefined {
  const additional = schema.additionalProperties;
  if (additional !== false) {
    const additionalField = `${field}.additionalProperties`;
    const nested = dataRecord(additional);
    if (nested === undefined) return issue("INVALID_SCHEMA", field);
    const nestedIssue = subschemaIssue(
      nested,
      additionalField,
      depth + 1,
      budget,
    );
    if (nestedIssue !== undefined) return nestedIssue;
  }
  if (!Object.hasOwn(schema, "properties")) return undefined;
  const propertiesField = `${field}.properties`;
  const properties = dataRecord(schema.properties);
  if (properties === undefined) return issue("INVALID_SCHEMA", propertiesField);
  for (const [name, candidate] of Object.entries(properties)) {
    const propertyField = `${propertiesField}.${name}`;
    const property = dataRecord(candidate);
    if (property === undefined) return issue("INVALID_SCHEMA", propertyField);
    const propertyIssue = subschemaIssue(
      property,
      propertyField,
      depth + 1,
      budget,
    );
    if (propertyIssue !== undefined) return propertyIssue;
  }
  return undefined;
}

function arrayIssue(
  schema: Record<string, unknown>,
  field: string,
  depth: number,
  budget: Budget,
): PackManifestValidationIssue | undefined {
  const items = dataRecord(schema.items);
  if (items === undefined) return issue("INVALID_SCHEMA", field);
  return subschemaIssue(items, `${field}.items`, depth + 1, budget);
}

function declaresShape(schema: Record<string, unknown>): boolean {
  return (
    (typeof schema.type === "string" && JSON_TYPES.has(schema.type)) ||
    Object.hasOwn(schema, "const") ||
    Object.hasOwn(schema, "enum")
  );
}

/**
 * Copies a plain object's own data properties without invoking accessors, so a
 * hostile candidate cannot present one shape to validation and another to use.
 */
function dataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const copy: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    copy[key] = descriptor.value;
  }
  return copy;
}
