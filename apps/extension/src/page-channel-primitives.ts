import { PageProtocolValidationError } from "./page-channel-types.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const BINDING_FIELDS = [
  "channelId",
  "contextId",
  "contextRevision",
  "tabId",
  "documentId",
  "origin",
] as const;

export function validateBinding(message: Record<string, unknown>): void {
  identifier(message.channelId, "channelId");
  identifier(message.contextId, "contextId");
  positiveInteger(message.contextRevision, "contextRevision");
  if (
    typeof message.tabId !== "number" ||
    !Number.isSafeInteger(message.tabId) ||
    message.tabId < 0 ||
    message.tabId > 2_147_483_647
  ) {
    invalidValue("tabId");
  }
  identifier(message.documentId, "documentId");
  validateOrigin(message.origin, "origin");
}

export function validateImplementation(value: unknown): void {
  if (!isRecord(value)) invalidType("implementation");
  exact(value, ["name", "version"], [], "implementation");
  identifier(value.name, "implementation.name", 64);
  if (
    typeof value.version !== "string" ||
    value.version.length > 64 ||
    !STABLE_SEMVER.test(value.version)
  ) {
    invalidValue("implementation.version");
  }
}

export function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  field = "$",
): void {
  for (const name of required) {
    if (!Object.hasOwn(value, name)) invalidValue(`${field}.${name}`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new PageProtocolValidationError(
        "UNKNOWN_FIELD",
        `${field}.${typeof key === "string" ? key : "[symbol]"}`,
      );
    }
  }
}

export function identifier(value: unknown, field: string, maximum = 128): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !IDENTIFIER.test(value)
  ) {
    throw new PageProtocolValidationError("INVALID_IDENTIFIER", field);
  }
}

export function toolName(value: unknown, field: string): void {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 128 ||
    !TOOL_NAME.test(value)
  ) {
    throw new PageProtocolValidationError("INVALID_IDENTIFIER", field);
  }
}

export function positiveInteger(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalidValue(field);
  }
}

export function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (typeof value !== "string") invalidType(field);
  const length = Array.from(value).length;
  if (length < minimum || length > maximum) {
    throw new PageProtocolValidationError("LIMIT_EXCEEDED", field);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function invalidType(field: string): never {
  throw new PageProtocolValidationError("INVALID_TYPE", field);
}

export function invalidValue(field: string): never {
  throw new PageProtocolValidationError("INVALID_VALUE", field);
}

export function wrongDirection(field: string): never {
  throw new PageProtocolValidationError("WRONG_DIRECTION", field);
}

function validateOrigin(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new PageProtocolValidationError("INVALID_ORIGIN", field);
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.origin !== value
    ) {
      throw new Error("noncanonical origin");
    }
  } catch {
    throw new PageProtocolValidationError("INVALID_ORIGIN", field);
  }
}
