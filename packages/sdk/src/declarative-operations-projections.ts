import {
  canonicalizeOrThrow,
  encodeUtf8,
} from "./declarative-bundle-canonical.js";
import { hasNoncharacter, isWellFormed } from "./declarative-bundle-limits.js";
import {
  MAX_OPERATION_LIST_ITEMS,
  MAX_OPERATION_OBJECT_FIELDS,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_KEY_CHARS,
  MAX_OUTPUT_NODES,
  MAX_PROJECTION_DEPTH,
  MAX_TEXT_CHARS,
} from "./declarative-operations-limits.js";
import type { DeclarativeOperationsValidationIssue } from "./declarative-operations-types.js";
import {
  boundedArray,
  isRecord,
  validateJsonBounds,
  type RecordValue,
} from "./validation/primitives.js";
import {
  OUTPUT_ATTRIBUTES,
  OUTPUT_KEY,
  SAFE_FIELD_NAMES,
  closedObject,
  operationIssue,
  validateStaticLiteral,
} from "./declarative-operations-validation-support.js";
import { validateDescendantScope } from "./declarative-operations-locators.js";

export function validateProjection(
  value: unknown,
  prefix: string,
  depth: number,
): DeclarativeOperationsValidationIssue | undefined {
  if (depth > MAX_PROJECTION_DEPTH)
    return operationIssue("LIMIT_EXCEEDED", prefix);
  if (!isRecord(value) || typeof value.kind !== "string")
    return operationIssue("INVALID_TYPE", prefix);
  switch (value.kind) {
    case "text":
      return validateExactFields(value, ["kind"], [], prefix);
    case "attribute": {
      const checked = closedObject(value, ["kind", "name"], [], prefix);
      if (checked.issue !== undefined) return checked.issue;
      return validateAttributeName(checked.value.name, `${prefix}.name`);
    }
    case "constant": {
      const checked = closedObject(value, ["kind", "value"], [], prefix);
      if (checked.issue !== undefined) return checked.issue;
      return validateOutputLiteral(checked.value.value, `${prefix}.value`);
    }
    case "number":
    case "percentage":
    case "boolean": {
      const checked = closedObject(value, ["kind", "source"], [], prefix);
      if (checked.issue !== undefined) return checked.issue;
      return validateScalarSource(checked.value.source, `${prefix}.source`);
    }
    case "optional": {
      const checked = closedObject(value, ["kind", "value"], [], prefix);
      if (checked.issue !== undefined) return checked.issue;
      return validateProjection(
        checked.value.value,
        `${prefix}.value`,
        depth + 1,
      );
    }
    case "descendant": {
      const checked = closedObject(
        value,
        ["kind", "scope", "projection"],
        [],
        prefix,
      );
      if (checked.issue !== undefined) return checked.issue;
      const scopeIssue = validateDescendantScope(
        checked.value.scope,
        `${prefix}.scope`,
      );
      if (scopeIssue !== undefined) return scopeIssue;
      return validateProjection(
        checked.value.projection,
        `${prefix}.projection`,
        depth + 1,
      );
    }
    case "object": {
      const checked = closedObject(value, ["kind", "fields"], [], prefix);
      if (checked.issue !== undefined) return checked.issue;
      if (!boundedArray(checked.value.fields, 0, MAX_OPERATION_OBJECT_FIELDS))
        return operationIssue("LIMIT_EXCEEDED", `${prefix}.fields`);
      const keys = new Set<string>();
      for (const [index, candidate] of checked.value.fields.entries()) {
        const fieldPrefix = `${prefix}.fields[${index}]`;
        const field = closedObject(
          candidate,
          ["key", "value"],
          [],
          fieldPrefix,
        );
        if (field.issue !== undefined) return field.issue;
        if (
          typeof field.value.key !== "string" ||
          Array.from(field.value.key).length > MAX_OUTPUT_KEY_CHARS ||
          !OUTPUT_KEY.test(field.value.key) ||
          SAFE_FIELD_NAMES.has(field.value.key) ||
          keys.has(field.value.key)
        ) {
          return operationIssue("CONFLICTING_PROJECTION", `${fieldPrefix}.key`);
        }
        const staticIssue = validateStaticLiteral(
          field.value.key,
          `${fieldPrefix}.key`,
        );
        if (staticIssue !== undefined) return staticIssue;
        keys.add(field.value.key);
        const valueIssue = validateProjection(
          field.value.value,
          `${fieldPrefix}.value`,
          depth + 1,
        );
        if (valueIssue !== undefined) return valueIssue;
      }
      return undefined;
    }
    case "array": {
      const checked = closedObject(value, ["kind", "items"], [], prefix);
      if (checked.issue !== undefined) return checked.issue;
      if (!boundedArray(checked.value.items, 0, MAX_OPERATION_LIST_ITEMS))
        return operationIssue("LIMIT_EXCEEDED", `${prefix}.items`);
      for (const [index, item] of checked.value.items.entries()) {
        const itemIssue = validateProjection(
          item,
          `${prefix}.items[${index}]`,
          depth + 1,
        );
        if (itemIssue !== undefined) return itemIssue;
      }
      return undefined;
    }
    default:
      return operationIssue("UNSUPPORTED_OPERATION", `${prefix}.kind`);
  }
}

function validateScalarSource(
  value: unknown,
  prefix: string,
): DeclarativeOperationsValidationIssue | undefined {
  if (!isRecord(value) || typeof value.kind !== "string")
    return operationIssue("INVALID_TYPE", prefix);
  if (value.kind === "text")
    return validateExactFields(value, ["kind"], [], prefix);
  if (value.kind === "attribute") {
    const checked = closedObject(value, ["kind", "name"], [], prefix);
    return (
      checked.issue ??
      validateAttributeName(checked.value.name, `${prefix}.name`)
    );
  }
  return operationIssue("UNSUPPORTED_OPERATION", `${prefix}.kind`);
}

function validateAttributeName(
  value: unknown,
  field: string,
): DeclarativeOperationsValidationIssue | undefined {
  return typeof value === "string" && OUTPUT_ATTRIBUTES.has(value)
    ? undefined
    : operationIssue("INVALID_SELECTOR", field);
}

function validateExactFields(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[],
  field: string,
): DeclarativeOperationsValidationIssue | undefined {
  return closedObject(value, required, optional, field).issue;
}

function validateOutputLiteral(
  value: unknown,
  field: string,
): DeclarativeOperationsValidationIssue | undefined {
  const boundIssue = validateJsonBounds(value);
  if (boundIssue !== undefined) return operationIssue(boundIssue.code, field);
  const stack = [{ value, field }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    nodes += 1;
    if (nodes > MAX_OUTPUT_NODES)
      return operationIssue("LIMIT_EXCEEDED", field);
    if (typeof current.value === "string") {
      if (Array.from(current.value).length > MAX_TEXT_CHARS)
        return operationIssue("LIMIT_EXCEEDED", current.field);
      if (!isWellFormed(current.value) || hasNoncharacter(current.value))
        return operationIssue("INVALID_VALUE", field);
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_OPERATION_LIST_ITEMS)
        return operationIssue("LIMIT_EXCEEDED", current.field);
      current.value.forEach((child, index) =>
        stack.push({ value: child, field: `${current.field}[${index}]` }),
      );
    } else if (isRecord(current.value)) {
      for (const key of Object.keys(current.value)) {
        if (
          !OUTPUT_KEY.test(key) ||
          SAFE_FIELD_NAMES.has(key) ||
          !isWellFormed(key) ||
          hasNoncharacter(key)
        )
          return operationIssue("INVALID_PROJECTION", field);
        stack.push({
          value: current.value[key],
          field: `${current.field}.[property]`,
        });
      }
    }
  }
  try {
    return encodeUtf8(canonicalizeOrThrow(value)).byteLength <= MAX_OUTPUT_BYTES
      ? undefined
      : operationIssue("LIMIT_EXCEEDED", field);
  } catch {
    return operationIssue("INVALID_VALUE", field);
  }
}
