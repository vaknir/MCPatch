import { hasNoncharacter, isWellFormed } from "./declarative-bundle-limits.js";
import {
  DECLARATIVE_ARIA_ROLES,
  DECLARATIVE_HTML_TAGS,
  DECLARATIVE_LOCATOR_ATTRIBUTES,
  DECLARATIVE_OUTPUT_ATTRIBUTES,
  type DeclarativeOperationsValidationIssue,
} from "./declarative-operations-types.js";
import {
  closedObject as rawClosedObject,
  type RecordValue,
} from "./validation/primitives.js";

export const ROLES = new Set<string>(DECLARATIVE_ARIA_ROLES);
export const TAGS = new Set<string>(DECLARATIVE_HTML_TAGS);
export const OUTPUT_ATTRIBUTES = new Set<string>(DECLARATIVE_OUTPUT_ATTRIBUTES);
export const LOCATOR_ATTRIBUTES = new Set<string>(
  DECLARATIVE_LOCATOR_ATTRIBUTES,
);
export const DYNAMIC_REFERENCE =
  /(?:\$\{|\{\{|\}\}|\barguments\b|\binput\.|\bmcp\.)/u;
export const SELECTOR_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u;
export const SELECTOR_CLASS = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;
export const OUTPUT_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
export const SAFE_FIELD_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export type OperationObjectCheck =
  | { readonly value: RecordValue; readonly issue?: undefined }
  | {
      readonly value?: undefined;
      readonly issue: DeclarativeOperationsValidationIssue;
    };

export function operationIssue(
  code: DeclarativeOperationsValidationIssue["code"] | string,
  field: string,
): DeclarativeOperationsValidationIssue {
  return { code: code as DeclarativeOperationsValidationIssue["code"], field };
}

/** Object-level validation keeps untrusted keys out of public error paths. */
export function closedObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  field: string,
): OperationObjectCheck {
  const checked = rawClosedObject(value, required, optional, field);
  if (checked.issue === undefined) return { value: checked.value };
  return {
    issue: {
      code: checked.issue.code as DeclarativeOperationsValidationIssue["code"],
      field:
        checked.issue.code === "UNKNOWN_FIELD" ? field : checked.issue.field,
    },
  };
}

export function validateOperationsUnicode(
  value: unknown,
): DeclarativeOperationsValidationIssue | undefined {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      if (!isWellFormed(current) || hasNoncharacter(current)) {
        return operationIssue("INVALID_VALUE", "operations.program");
      }
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (isRecordLike(current)) {
      for (const key of Object.keys(current)) {
        if (!isWellFormed(key) || hasNoncharacter(key)) {
          return operationIssue("INVALID_VALUE", "operations.program");
        }
        stack.push(current[key]);
      }
    }
  }
  return undefined;
}

export function validateNodeLimit(
  value: unknown,
  field: string,
  maximum: number,
): DeclarativeOperationsValidationIssue | undefined {
  let nodes = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > maximum) return operationIssue("LIMIT_EXCEEDED", field);
    if (Array.isArray(current)) stack.push(...current);
    else if (isRecordLike(current)) stack.push(...Object.values(current));
  }
  return undefined;
}

export function validateLiteralText(
  value: unknown,
  maximum: number,
  field: string,
  optional: boolean,
): DeclarativeOperationsValidationIssue | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string") return operationIssue("INVALID_TYPE", field);
  const length = Array.from(value).length;
  if (length === 0 || length > maximum)
    return operationIssue("LIMIT_EXCEEDED", field);
  return validateStaticLiteral(value, field);
}

export function validateStaticLiteral(
  value: string,
  field: string,
): DeclarativeOperationsValidationIssue | undefined {
  return DYNAMIC_REFERENCE.test(value)
    ? operationIssue("DYNAMIC_REFERENCE", field)
    : undefined;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
