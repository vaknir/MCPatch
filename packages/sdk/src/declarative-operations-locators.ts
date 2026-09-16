import {
  MAX_ACCESSIBLE_NAME_CHARS,
  MAX_OPERATION_LIST_ITEMS,
  MAX_SELECTOR_ATTRIBUTE_VALUE_CHARS,
  MAX_SELECTOR_ATTRIBUTES,
  MAX_SELECTOR_CLASS_CHARS,
  MAX_SELECTOR_CLASSES,
  MAX_SELECTOR_ID_CHARS,
} from "./declarative-operations-limits.js";
import type { DeclarativeOperationsValidationIssue } from "./declarative-operations-types.js";
import {
  boundedArray,
  boundedInteger,
  isRecord,
} from "./validation/primitives.js";
import {
  closedObject,
  LOCATOR_ATTRIBUTES,
  ROLES,
  SELECTOR_CLASS,
  SELECTOR_ID,
  TAGS,
  operationIssue,
  validateLiteralText,
  validateStaticLiteral,
} from "./declarative-operations-validation-support.js";

export function validateAvailability(
  value: unknown,
  prefix: string,
): DeclarativeOperationsValidationIssue | undefined {
  const checked = closedObject(value, ["kind", "locator"], [], prefix);
  if (checked.issue !== undefined) return checked.issue;
  return checked.value.kind === "present"
    ? validateLocator(checked.value.locator, `${prefix}.locator`)
    : operationIssue("UNSUPPORTED_OPERATION", `${prefix}.kind`);
}

export function validateScope(
  value: unknown,
  prefix: string,
): DeclarativeOperationsValidationIssue | undefined {
  if (!isRecord(value)) return operationIssue("INVALID_TYPE", prefix);
  if (value.kind === "single") {
    const checked = closedObject(value, ["kind", "locator"], [], prefix);
    return (
      checked.issue ??
      validateLocator(checked.value.locator, `${prefix}.locator`)
    );
  }
  if (value.kind === "list") {
    const checked = closedObject(
      value,
      ["kind", "locator", "maxMatches"],
      [],
      prefix,
    );
    if (checked.issue !== undefined) return checked.issue;
    const locatorIssue = validateLocator(
      checked.value.locator,
      `${prefix}.locator`,
    );
    if (locatorIssue !== undefined) return locatorIssue;
    return boundedInteger(checked.value.maxMatches, 1, MAX_OPERATION_LIST_ITEMS)
      ? undefined
      : operationIssue("LIMIT_EXCEEDED", `${prefix}.maxMatches`);
  }
  return operationIssue("UNSUPPORTED_OPERATION", `${prefix}.kind`);
}

export function validateDescendantScope(
  value: unknown,
  prefix: string,
): DeclarativeOperationsValidationIssue | undefined {
  if (!isRecord(value)) return operationIssue("INVALID_TYPE", prefix);
  if (value.kind === "single") {
    const checked = closedObject(value, ["kind", "locator"], [], prefix);
    return (
      checked.issue ??
      validateLocator(checked.value.locator, `${prefix}.locator`)
    );
  }
  if (value.kind === "list") {
    const checked = closedObject(
      value,
      ["kind", "locator", "maxMatches"],
      [],
      prefix,
    );
    if (checked.issue !== undefined) return checked.issue;
    const locatorIssue = validateLocator(
      checked.value.locator,
      `${prefix}.locator`,
    );
    if (locatorIssue !== undefined) return locatorIssue;
    return boundedInteger(checked.value.maxMatches, 1, MAX_OPERATION_LIST_ITEMS)
      ? undefined
      : operationIssue("LIMIT_EXCEEDED", `${prefix}.maxMatches`);
  }
  return operationIssue("UNSUPPORTED_OPERATION", `${prefix}.kind`);
}

export function validateLocator(
  value: unknown,
  prefix: string,
): DeclarativeOperationsValidationIssue | undefined {
  if (!isRecord(value)) return operationIssue("INVALID_TYPE", prefix);
  if (value.kind === "role") {
    const checked = closedObject(value, ["kind", "role"], ["name"], prefix);
    if (checked.issue !== undefined) return checked.issue;
    if (
      typeof checked.value.role !== "string" ||
      !ROLES.has(checked.value.role)
    ) {
      return operationIssue("INVALID_SELECTOR", `${prefix}.role`);
    }
    return validateLiteralText(
      checked.value.name,
      MAX_ACCESSIBLE_NAME_CHARS,
      `${prefix}.name`,
      true,
    );
  }
  if (value.kind === "selector") {
    const checked = closedObject(
      value,
      ["kind"],
      ["tag", "id", "classes", "attributes"],
      prefix,
    );
    if (checked.issue !== undefined) return checked.issue;
    const hasComponent = ["tag", "id", "classes", "attributes"].some((key) =>
      Object.hasOwn(checked.value, key),
    );
    if (!hasComponent) return operationIssue("INVALID_SELECTOR", prefix);
    if (
      Object.hasOwn(checked.value, "tag") &&
      (typeof checked.value.tag !== "string" || !TAGS.has(checked.value.tag))
    ) {
      return operationIssue("INVALID_SELECTOR", `${prefix}.tag`);
    }
    if (Object.hasOwn(checked.value, "id")) {
      if (
        typeof checked.value.id !== "string" ||
        Array.from(checked.value.id).length > MAX_SELECTOR_ID_CHARS ||
        !SELECTOR_ID.test(checked.value.id)
      ) {
        return operationIssue("INVALID_SELECTOR", `${prefix}.id`);
      }
      const dynamicIssue = validateStaticLiteral(
        checked.value.id,
        `${prefix}.id`,
      );
      if (dynamicIssue !== undefined) return dynamicIssue;
    }
    if (Object.hasOwn(checked.value, "classes")) {
      if (!boundedArray(checked.value.classes, 1, MAX_SELECTOR_CLASSES))
        return operationIssue("LIMIT_EXCEEDED", `${prefix}.classes`);
      const classes = new Set<string>();
      for (const [index, className] of checked.value.classes.entries()) {
        if (
          typeof className !== "string" ||
          Array.from(className).length > MAX_SELECTOR_CLASS_CHARS ||
          !SELECTOR_CLASS.test(className) ||
          classes.has(className)
        ) {
          return operationIssue(
            "INVALID_SELECTOR",
            `${prefix}.classes[${index}]`,
          );
        }
        classes.add(className);
      }
    }
    if (Object.hasOwn(checked.value, "attributes")) {
      if (!boundedArray(checked.value.attributes, 1, MAX_SELECTOR_ATTRIBUTES))
        return operationIssue("LIMIT_EXCEEDED", `${prefix}.attributes`);
      const attributes = new Set<string>();
      for (const [index, candidate] of checked.value.attributes.entries()) {
        const attributePrefix = `${prefix}.attributes[${index}]`;
        const attribute = closedObject(
          candidate,
          ["name", "value"],
          [],
          attributePrefix,
        );
        if (attribute.issue !== undefined) return attribute.issue;
        if (
          typeof attribute.value.name !== "string" ||
          !LOCATOR_ATTRIBUTES.has(attribute.value.name) ||
          attributes.has(attribute.value.name)
        ) {
          return operationIssue("INVALID_SELECTOR", `${attributePrefix}.name`);
        }
        attributes.add(attribute.value.name);
        const textIssue = validateLiteralText(
          attribute.value.value,
          MAX_SELECTOR_ATTRIBUTE_VALUE_CHARS,
          `${attributePrefix}.value`,
          false,
        );
        if (textIssue !== undefined) return textIssue;
      }
      if (Object.hasOwn(checked.value, "id") && attributes.has("id")) {
        return operationIssue("CONFLICTING_PROJECTION", `${prefix}.attributes`);
      }
    }
    return undefined;
  }
  return operationIssue("UNSUPPORTED_OPERATION", `${prefix}.kind`);
}
