import type { ValidationCode, ValidationIssue } from "./error.js";
import { PROTOCOL_VERSION } from "../types/common.js";

export type JsonRecord = Record<string, unknown>;

interface ObjectCheck {
  readonly value?: JsonRecord;
  readonly issue?: ValidationIssue;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export function issue(code: ValidationCode, field: string): ValidationIssue {
  return { code, field };
}

export function checkClosedObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  field = "$",
): ObjectCheck {
  if (!isRecord(value)) {
    return { issue: issue("INVALID_TYPE", field) };
  }

  for (const name of required) {
    if (!Object.hasOwn(value, name)) {
      return { issue: issue("INVALID_VALUE", `${field}.${name}`) };
    }
  }

  const allowed = new Set([...required, ...optional]);
  const ownKeys = Reflect.ownKeys(value);
  const symbolKey = ownKeys.find((name) => typeof name !== "string");
  if (symbolKey !== undefined) {
    return { issue: issue("UNKNOWN_FIELD", `${field}.[symbol]`) };
  }
  const unknown = (ownKeys as string[]).find((name) => !allowed.has(name));
  if (unknown !== undefined) {
    return { issue: issue("UNKNOWN_FIELD", `${field}.${unknown}`) };
  }

  return { value };
}

export function validateProtocolVersion(
  value: unknown,
): ValidationIssue | undefined {
  if (value !== PROTOCOL_VERSION) {
    return issue("UNSUPPORTED_VERSION", "protocolVersion");
  }
  return undefined;
}

export function validateIdentifier(
  value: unknown,
  field: string,
  maximum = 128,
): ValidationIssue | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return issue("INVALID_IDENTIFIER", field);
  }
  return undefined;
}

export function validateToolName(
  value: unknown,
  field: string,
): ValidationIssue | undefined {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 128 ||
    !TOOL_NAME_PATTERN.test(value)
  ) {
    return issue("INVALID_IDENTIFIER", field);
  }
  return undefined;
}

export function validatePositiveSafeInteger(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): ValidationIssue | undefined {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    return issue("INVALID_VALUE", field);
  }
  return undefined;
}

export function validateBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): ValidationIssue | undefined {
  if (typeof value !== "string") {
    return issue("INVALID_TYPE", field);
  }
  const length = Array.from(value).length;
  if (length < minimum || length > maximum) {
    return issue("LIMIT_EXCEEDED", field);
  }
  return undefined;
}

export function validateImplementation(
  value: unknown,
): ValidationIssue | undefined {
  const checked = checkClosedObject(
    value,
    ["name", "version"],
    [],
    "implementation",
  );
  if (checked.issue !== undefined) return checked.issue;
  const implementation = checked.value as JsonRecord;
  return (
    validateIdentifier(implementation.name, "implementation.name", 64) ??
    validateBoundedText(implementation.version, 1, 64, "implementation.version")
  );
}

export function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
