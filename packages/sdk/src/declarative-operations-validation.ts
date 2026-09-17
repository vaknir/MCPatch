import type { PackToolManifest } from "./types.js";
import {
  canonicalizeOrThrow,
  encodeUtf8,
} from "./declarative-bundle-canonical.js";
import {
  MAX_OPERATION_AST_NODES,
  MAX_OPERATIONS_PAYLOAD_BYTES,
} from "./declarative-operations-limits.js";
import {
  DECLARATIVE_OPERATIONS_PROGRAM_VERSION,
  type DeclarativeProjection,
  type DeclarativeOperationsValidationIssue,
} from "./declarative-operations-types.js";
import {
  boundedArray,
  isRecord,
  validateJsonBounds,
} from "./validation/primitives.js";
import {
  closedObject,
  operationIssue,
  validateNodeLimit,
  validateOperationsUnicode,
} from "./declarative-operations-validation-support.js";
import {
  validateAvailability,
  validateScope,
} from "./declarative-operations-locators.js";
import { validateProjection } from "./declarative-operations-projections.js";
import { validateOutputSchema } from "./declarative-operations-schema-support.js";

const PROGRAM_FIELDS = ["version", "operations"] as const;
const READ_OPERATION_FIELDS = [
  "kind",
  "tool",
  "availability",
  "scope",
  "projection",
] as const;
const NAVIGATION_OPERATION_FIELDS = [
  "kind",
  "tool",
  "navigationVersion",
  "path",
  "query",
] as const;
const ARGUMENT = /^[a-z][a-zA-Z0-9_]{0,63}$/u;
const QUERY_KEY = /^[A-Za-z][A-Za-z0-9._~-]{0,63}$/u;
const PATH_LITERAL = /^[A-Za-z0-9_~-]+$/u;

export function validateDeclarativeOperations(
  value: unknown,
  tools: readonly PackToolManifest[],
  operationsVersion: 1 | 2 = 1,
): DeclarativeOperationsValidationIssue | undefined {
  const boundIssue = validateJsonBounds(value);
  if (boundIssue !== undefined)
    return operationIssue(boundIssue.code, "operations.program");
  const unicodeIssue = validateOperationsUnicode(value);
  if (unicodeIssue !== undefined) return unicodeIssue;
  if (!isRecord(value))
    return operationIssue("INVALID_TYPE", "operations.program");
  try {
    if (
      encodeUtf8(canonicalizeOrThrow(value)).byteLength >
      MAX_OPERATIONS_PAYLOAD_BYTES
    ) {
      return operationIssue("LIMIT_EXCEEDED", "operations.program");
    }
  } catch {
    return operationIssue("INVALID_VALUE", "operations.program");
  }

  const checked = closedObject(value, PROGRAM_FIELDS, [], "operations.program");
  if (checked.issue !== undefined) return checked.issue;
  if (
    checked.value.version !== operationsVersion ||
    (checked.value.version !== 1 &&
      checked.value.version !== DECLARATIVE_OPERATIONS_PROGRAM_VERSION)
  ) {
    return operationIssue("UNSUPPORTED_VERSION", "operations.program.version");
  }
  const operations = checked.value.operations;
  if (
    !boundedArray(operations, 1, tools.length) ||
    operations.length !== tools.length
  ) {
    return operationIssue("INVALID_REFERENCE", "operations.program.operations");
  }

  const declaredTools = new Map(tools.map((tool) => [tool.name, tool]));
  const operationNames = new Set<string>();
  for (const [index, candidate] of operations.entries()) {
    const prefix = `operations.program.operations[${index}]`;
    const nodeIssue = validateNodeLimit(
      candidate,
      prefix,
      MAX_OPERATION_AST_NODES,
    );
    if (nodeIssue !== undefined) return nodeIssue;
    const operationIssueResult = validateOperation(
      candidate,
      prefix,
      declaredTools,
      operationNames,
      operationsVersion,
    );
    if (operationIssueResult !== undefined) return operationIssueResult;
  }
  for (const tool of tools) {
    if (!operationNames.has(tool.name))
      return operationIssue(
        "INVALID_REFERENCE",
        "operations.program.operations",
      );
  }
  return undefined;
}

function validateOperation(
  value: unknown,
  prefix: string,
  tools: ReadonlyMap<string, PackToolManifest>,
  names: Set<string>,
  operationsVersion: 1 | 2,
): DeclarativeOperationsValidationIssue | undefined {
  if (!isRecord(value)) return operationIssue("INVALID_TYPE", prefix);
  if (value.kind === "navigate") {
    if (operationsVersion !== 2) {
      return operationIssue("UNSUPPORTED_OPERATION", `${prefix}.kind`);
    }
    return validateNavigationOperation(value, prefix, tools, names);
  }
  const checked = closedObject(value, READ_OPERATION_FIELDS, [], prefix);
  if (checked.issue !== undefined) return checked.issue;
  if (checked.value.kind !== "read")
    return operationIssue("UNSUPPORTED_OPERATION", `${prefix}.kind`);
  if (typeof checked.value.tool !== "string")
    return operationIssue("INVALID_TYPE", `${prefix}.tool`);
  const tool = tools.get(checked.value.tool);
  if (tool === undefined)
    return operationIssue("INVALID_REFERENCE", `${prefix}.tool`);
  if (names.has(checked.value.tool))
    return operationIssue("DUPLICATE_VALUE", `${prefix}.tool`);
  names.add(checked.value.tool);

  const policyIssue = validateDeclarativeToolPolicy(tool, `${prefix}.tool`);
  if (policyIssue !== undefined) return policyIssue;
  const availabilityIssue = validateAvailability(
    checked.value.availability,
    `${prefix}.availability`,
  );
  if (availabilityIssue !== undefined) return availabilityIssue;
  const scopeIssue = validateScope(checked.value.scope, `${prefix}.scope`);
  if (scopeIssue !== undefined) return scopeIssue;
  const projectionIssue = validateProjection(
    checked.value.projection,
    `${prefix}.projection`,
    1,
  );
  if (projectionIssue !== undefined) return projectionIssue;
  return validateOutputSchema(
    checked.value.projection as DeclarativeProjection,
    checked.value.scope,
    tool.outputSchema,
    `${prefix}.projection`,
  );
}

function validateNavigationOperation(
  value: Record<string, unknown>,
  prefix: string,
  tools: ReadonlyMap<string, PackToolManifest>,
  names: Set<string>,
): DeclarativeOperationsValidationIssue | undefined {
  const checked = closedObject(value, NAVIGATION_OPERATION_FIELDS, [], prefix);
  if (checked.issue !== undefined) return checked.issue;
  if (checked.value.navigationVersion !== 1) {
    return operationIssue("UNSUPPORTED_VERSION", `${prefix}.navigationVersion`);
  }
  if (typeof checked.value.tool !== "string") {
    return operationIssue("INVALID_TYPE", `${prefix}.tool`);
  }
  const tool = tools.get(checked.value.tool);
  if (tool === undefined) {
    return operationIssue("INVALID_REFERENCE", `${prefix}.tool`);
  }
  if (names.has(checked.value.tool)) {
    return operationIssue("DUPLICATE_VALUE", `${prefix}.tool`);
  }
  names.add(checked.value.tool);
  const schema = validateNavigationToolPolicy(tool, `${prefix}.tool`);
  if ("issue" in schema) return schema.issue;
  const references = new Set<string>();
  const pathIssue = validateNavigationPath(
    checked.value.path,
    `${prefix}.path`,
    schema.arguments,
    references,
  );
  if (pathIssue !== undefined) return pathIssue;
  const queryIssue = validateNavigationQuery(
    checked.value.query,
    `${prefix}.query`,
    schema.arguments,
    references,
  );
  if (queryIssue !== undefined) return queryIssue;
  return references.size === schema.arguments.size
    ? undefined
    : operationIssue("INVALID_REFERENCE", `${prefix}.tool.inputSchema`);
}

function validateNavigationToolPolicy(
  tool: PackToolManifest,
  field: string,
):
  | { readonly arguments: ReadonlySet<string> }
  | { readonly issue: DeclarativeOperationsValidationIssue } {
  if (tool.risk !== "action") {
    return { issue: operationIssue("INVALID_VALUE", `${field}.risk`) };
  }
  if (tool.permissions.length !== 1 || tool.permissions[0] !== "ACTION") {
    return { issue: operationIssue("INVALID_VALUE", `${field}.permissions`) };
  }
  const schema = tool.inputSchema;
  const root = closedObject(
    schema,
    ["type", "additionalProperties", "properties", "required"],
    [],
    `${field}.inputSchema`,
  );
  if (
    root.issue !== undefined ||
    root.value.type !== "object" ||
    root.value.additionalProperties !== false ||
    !isRecord(root.value.properties) ||
    !Array.isArray(root.value.required)
  ) {
    return {
      issue:
        root.issue ?? operationIssue("INVALID_SCHEMA", `${field}.inputSchema`),
    };
  }
  const names = Object.keys(root.value.properties);
  if (
    names.length < 1 ||
    names.length > 16 ||
    names.some((name) => !ARGUMENT.test(name)) ||
    root.value.required.length !== names.length ||
    new Set(root.value.required).size !== names.length ||
    root.value.required.some(
      (name) => typeof name !== "string" || !names.includes(name),
    )
  ) {
    return {
      issue: operationIssue("INVALID_SCHEMA", `${field}.inputSchema`),
    };
  }
  for (const name of names) {
    const property = root.value.properties[name];
    if (!validNavigationArgumentSchema(property)) {
      return {
        issue: operationIssue(
          "INVALID_SCHEMA",
          `${field}.inputSchema.properties.${name}`,
        ),
      };
    }
  }
  if (!validNavigationOutputSchema(tool.outputSchema)) {
    return { issue: operationIssue("INVALID_SCHEMA", `${field}.outputSchema`) };
  }
  return { arguments: new Set(names) };
}

function validNavigationArgumentSchema(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) => !["type", "minLength", "maxLength", "enum"].includes(key),
    ) ||
    value.type !== "string" ||
    value.minLength !== 1 ||
    !Number.isSafeInteger(value.maxLength) ||
    (value.maxLength as number) < 1 ||
    (value.maxLength as number) > 256
  ) {
    return false;
  }
  if (value.enum === undefined) return true;
  return (
    Array.isArray(value.enum) &&
    value.enum.length >= 1 &&
    value.enum.length <= 64 &&
    new Set(value.enum).size === value.enum.length &&
    value.enum.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length >= 1 &&
        Array.from(entry).length <= (value.maxLength as number) &&
        !hasControl(entry),
    )
  );
}

function validNavigationOutputSchema(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const root = closedObject(
    value,
    ["type", "additionalProperties", "required", "properties"],
    [],
    "outputSchema",
  );
  if (
    root.issue !== undefined ||
    root.value.type !== "object" ||
    root.value.additionalProperties !== false ||
    !Array.isArray(root.value.required) ||
    root.value.required.length !== 2 ||
    !root.value.required.includes("state") ||
    !root.value.required.includes("url") ||
    !isRecord(root.value.properties) ||
    Object.keys(root.value.properties).length !== 2
  ) {
    return false;
  }
  const state = root.value.properties.state;
  const url = root.value.properties.url;
  return (
    isRecord(state) &&
    Object.keys(state).length === 1 &&
    state.const === "scheduled" &&
    isRecord(url) &&
    Object.keys(url).length === 2 &&
    url.type === "string" &&
    url.maxLength === 2048
  );
}

function validateNavigationPath(
  value: unknown,
  field: string,
  arguments_: ReadonlySet<string>,
  references: Set<string>,
): DeclarativeOperationsValidationIssue | undefined {
  const path = closedObject(value, ["segments", "trailingSlash"], [], field);
  if (path.issue !== undefined) return path.issue;
  if (
    !Array.isArray(path.value.segments) ||
    path.value.segments.length > 32 ||
    typeof path.value.trailingSlash !== "boolean"
  ) {
    return operationIssue("INVALID_VALUE", field);
  }
  for (const [index, segment] of path.value.segments.entries()) {
    const issue = validateNavigationValue(
      segment,
      `${field}.segments[${index}]`,
      arguments_,
      references,
      true,
    );
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function validateNavigationQuery(
  value: unknown,
  field: string,
  arguments_: ReadonlySet<string>,
  references: Set<string>,
): DeclarativeOperationsValidationIssue | undefined {
  if (!Array.isArray(value) || value.length > 32) {
    return operationIssue("INVALID_VALUE", field);
  }
  const keys = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const itemField = `${field}[${index}]`;
    const query = closedObject(entry, ["key", "value"], [], itemField);
    if (query.issue !== undefined) return query.issue;
    if (
      typeof query.value.key !== "string" ||
      !QUERY_KEY.test(query.value.key)
    ) {
      return operationIssue("INVALID_VALUE", `${itemField}.key`);
    }
    if (keys.has(query.value.key)) {
      return operationIssue("DUPLICATE_VALUE", `${itemField}.key`);
    }
    keys.add(query.value.key);
    const issue = validateNavigationValue(
      query.value.value,
      `${itemField}.value`,
      arguments_,
      references,
      false,
    );
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function validateNavigationValue(
  value: unknown,
  field: string,
  arguments_: ReadonlySet<string>,
  references: Set<string>,
  path: boolean,
): DeclarativeOperationsValidationIssue | undefined {
  if (!isRecord(value)) return operationIssue("INVALID_TYPE", field);
  if (value.kind === "argument") {
    const argument = closedObject(value, ["kind", "name"], [], field);
    if (argument.issue !== undefined) return argument.issue;
    if (
      typeof argument.value.name !== "string" ||
      !arguments_.has(argument.value.name) ||
      references.has(argument.value.name)
    ) {
      return operationIssue("INVALID_REFERENCE", `${field}.name`);
    }
    references.add(argument.value.name);
    return undefined;
  }
  const literal = closedObject(value, ["kind", "value"], [], field);
  if (literal.issue !== undefined) return literal.issue;
  if (
    literal.value.kind !== "literal" ||
    typeof literal.value.value !== "string" ||
    literal.value.value.length === 0 ||
    Array.from(literal.value.value).length > 256 ||
    hasControl(literal.value.value) ||
    (path &&
      (!PATH_LITERAL.test(literal.value.value) ||
        literal.value.value === "." ||
        literal.value.value === ".."))
  ) {
    return operationIssue("INVALID_VALUE", `${field}.value`);
  }
  return undefined;
}

function hasControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function validateDeclarativeToolPolicy(
  tool: PackToolManifest,
  field: string,
): DeclarativeOperationsValidationIssue | undefined {
  if (tool.risk !== "read")
    return operationIssue("INVALID_VALUE", `${field}.risk`);
  if (tool.permissions.length !== 1 || tool.permissions[0] !== "READ")
    return operationIssue("INVALID_VALUE", `${field}.permissions`);
  if (tool.inputSchema.type !== "object")
    return operationIssue("INVALID_SCHEMA", `${field}.inputSchema`);
  const inputKeys = Object.keys(tool.inputSchema);
  if (
    inputKeys.some(
      (key) => !["type", "additionalProperties", "properties"].includes(key),
    ) ||
    tool.inputSchema.additionalProperties !== false ||
    !Object.hasOwn(tool.inputSchema, "properties") ||
    !isRecord(tool.inputSchema.properties) ||
    Object.keys(tool.inputSchema.properties).length !== 0
  ) {
    return operationIssue("INVALID_SCHEMA", `${field}.inputSchema`);
  }
  return undefined;
}
