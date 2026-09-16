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
const OPERATION_FIELDS = [
  "kind",
  "tool",
  "availability",
  "scope",
  "projection",
] as const;

export function validateDeclarativeOperations(
  value: unknown,
  tools: readonly PackToolManifest[],
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
  if (checked.value.version !== DECLARATIVE_OPERATIONS_PROGRAM_VERSION) {
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
): DeclarativeOperationsValidationIssue | undefined {
  const checked = closedObject(value, OPERATION_FIELDS, [], prefix);
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
