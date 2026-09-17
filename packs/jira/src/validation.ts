import { JiraPackError } from "./model.js";

export const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,9}-[1-9][0-9]{0,9}$/u;
export const JIRA_PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,9}$/u;
export const JIRA_NUMERIC_ID = /^[1-9][0-9]{0,18}$/u;
export const JIRA_LABEL = /^[^\s,]{1,255}$/u;
export const JIRA_CONTEXT_PATH =
  /^(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,4}$/u;

export const JIRA_MAX_SUMMARY_LENGTH = 255;
export const JIRA_MAX_TEXT_LENGTH = 8_192;
export const JIRA_MAX_JQL_LENGTH = 2_048;
export const JIRA_MAX_NAME_LENGTH = 64;
export const JIRA_MAX_LABELS = 16;
export const JIRA_MAX_PAGE_SIZE = 50;
export const JIRA_DEFAULT_PAGE_SIZE = 20;
export const JIRA_MAX_START_AT = 10_000;

export function invalidArguments(): never {
  throw new JiraPackError("EXECUTION_FAILED", "invalid_arguments");
}

export function isDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Reads an own data property, ignoring inherited and accessor-backed keys. */
export function dataValue(value: unknown, key: string): unknown {
  if (!isDataObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

/** Rejects any argument object that carries a key the tool does not declare. */
export function closedInput(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (!isDataObject(value)) invalidArguments();
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    invalidArguments();
  }
  return value;
}

export function requiredPattern(
  value: unknown,
  pattern: RegExp,
  maximum: number,
): string {
  if (typeof value !== "string" || value.length > maximum) invalidArguments();
  if (!pattern.test(value)) invalidArguments();
  return value;
}

export function requiredText(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value !== value.trim() ||
    hasControlCharacter(value)
  ) {
    invalidArguments();
  }
  return value;
}

export function optionalText(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): string | undefined {
  return Object.hasOwn(source, key)
    ? requiredText(dataValue(source, key), minimum, maximum)
    : undefined;
}

/** Comment and description bodies are the only inputs that may span lines. */
export function requiredBody(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value !== value.trim() ||
    hasControlCharacter(value, true)
  ) {
    invalidArguments();
  }
  return value;
}

export function optionalBody(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): string | undefined {
  return Object.hasOwn(source, key)
    ? requiredBody(dataValue(source, key), minimum, maximum)
    : undefined;
}

export function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value)) invalidArguments();
  const parsed = value as number;
  if (parsed < minimum || parsed > maximum) invalidArguments();
  return parsed;
}

export function optionalInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Object.hasOwn(source, key)
    ? boundedInteger(dataValue(source, key), minimum, maximum)
    : fallback;
}

export function optionalLabels(
  source: Record<string, unknown>,
  key: string,
): readonly string[] | undefined {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = dataValue(source, key);
  if (!Array.isArray(value) || value.length > JIRA_MAX_LABELS) {
    invalidArguments();
  }
  const labels = value.map((label) => {
    const checked = requiredPattern(label, JIRA_LABEL, 255);
    if (hasControlCharacter(checked)) invalidArguments();
    return checked;
  });
  if (new Set(labels).size !== labels.length) invalidArguments();
  return Object.freeze(labels);
}

/** Rejects framing characters; `multiline` keeps only tab and line feed. */
export function hasControlCharacter(value: string, multiline = false): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    const allowed = multiline && (code === 0x09 || code === 0x0a);
    return (code < 0x20 && !allowed) || code === 0x7f;
  });
}

export function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new JiraPackError("CANCELLED", "cancelled");
}
