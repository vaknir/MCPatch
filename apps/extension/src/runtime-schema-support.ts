import type { JsonObject } from "@mcpatch/sdk/runtime";

const MAX_DEPTH = 32;
const MAX_NODES = 8_192;
const SCHEMA_FIELDS = new Set([
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

/** Reports whether the MV3 runtime can interpret this schema without codegen. */
export function supportsRuntimeSchema(schema: JsonObject): boolean {
  return inspectSchema(schema, 0, { nodes: 0 });
}

function inspectSchema(
  schema: unknown,
  depth: number,
  budget: { nodes: number },
): schema is JsonObject {
  budget.nodes += 1;
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES || !isDataRecord(schema)) {
    return false;
  }
  if (Object.keys(schema).some((key) => !SCHEMA_FIELDS.has(key))) return false;
  if (
    Object.hasOwn(schema, "type") &&
    (typeof schema.type !== "string" || !JSON_TYPES.has(schema.type))
  ) {
    return false;
  }
  if (Object.hasOwn(schema, "const")) {
    if (!isJsonData(schema.const, depth + 1, budget)) return false;
  }
  if (Object.hasOwn(schema, "enum")) {
    const values = dataArrayValues(schema.enum);
    if (
      values === undefined ||
      values.length === 0 ||
      values.some((value) => !isJsonData(value, depth + 1, budget))
    ) {
      return false;
    }
  }
  if (!validBounds(schema)) return false;

  if (Object.hasOwn(schema, "properties")) {
    if (!isDataRecord(schema.properties)) return false;
    for (const key of Object.keys(schema.properties)) {
      const child = Object.getOwnPropertyDescriptor(
        schema.properties,
        key,
      )?.value;
      if (!inspectSchema(child, depth + 1, budget)) return false;
    }
  }
  if (Object.hasOwn(schema, "required")) {
    const required = dataArrayValues(schema.required);
    if (
      required === undefined ||
      required.some((key) => typeof key !== "string") ||
      new Set(required).size !== required.length
    ) {
      return false;
    }
  }
  if (
    Object.hasOwn(schema, "additionalProperties") &&
    typeof schema.additionalProperties !== "boolean" &&
    !inspectSchema(schema.additionalProperties, depth + 1, budget)
  ) {
    return false;
  }
  if (
    Object.hasOwn(schema, "items") &&
    !inspectSchema(schema.items, depth + 1, budget)
  ) {
    return false;
  }
  return true;
}

function isJsonData(
  value: unknown,
  depth: number,
  budget: { nodes: number },
): boolean {
  budget.nodes += 1;
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) return false;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  const array = dataArrayValues(value);
  if (array !== undefined) {
    return array.every((item) => isJsonData(item, depth + 1, budget));
  }
  if (!isDataRecord(value)) return false;
  return Object.keys(value).every((key) =>
    isJsonData(
      Object.getOwnPropertyDescriptor(value, key)?.value,
      depth + 1,
      budget,
    ),
  );
}

function dataArrayValues(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return undefined;
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    result.push(descriptor.value);
  }
  return result;
}

function validBounds(schema: Record<string, unknown>): boolean {
  for (const key of [
    "maxItems",
    "maxLength",
    "maxProperties",
    "minItems",
    "minLength",
    "minProperties",
  ]) {
    if (
      Object.hasOwn(schema, key) &&
      (!Number.isSafeInteger(schema[key]) || (schema[key] as number) < 0)
    ) {
      return false;
    }
  }
  for (const key of ["minimum", "maximum"]) {
    if (
      Object.hasOwn(schema, key) &&
      (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))
    ) {
      return false;
    }
  }
  return (
    orderedBounds(schema, "minItems", "maxItems") &&
    orderedBounds(schema, "minLength", "maxLength") &&
    orderedBounds(schema, "minProperties", "maxProperties") &&
    orderedBounds(schema, "minimum", "maximum")
  );
}

function orderedBounds(
  schema: Record<string, unknown>,
  minimumKey: string,
  maximumKey: string,
): boolean {
  const minimum = schema[minimumKey];
  const maximum = schema[maximumKey];
  return (
    typeof minimum !== "number" ||
    typeof maximum !== "number" ||
    minimum <= maximum
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
