import type { JsonObject } from "./types.js";
import type { DeclarativeNavigateOperation } from "./declarative-operations-types.js";
import { isRecord } from "./validation/primitives.js";

const ABSOLUTE_OR_PROTOCOL_RELATIVE =
  /^(?:(?:[a-z][a-z0-9+.-]*:\/\/)|(?:javascript|data|file|mailto):|\/\/)/iu;
const ENCODED_PATH_SYNTAX = /%(?:2e|2f|5c)/iu;
const MAX_NAVIGATION_URL_CODE_POINTS = 2_048;

export interface DeclarativeNavigationResult extends JsonObject {
  readonly state: "scheduled";
  readonly url: string;
}

/** Constructs one same-origin URL without interpreting arguments as URL syntax. */
export function createDeclarativeNavigationUrl(
  operation: DeclarativeNavigateOperation,
  args: JsonObject,
  currentOrigin: string,
): string {
  const origin = canonicalHttpsOrigin(currentOrigin);
  const values = readArguments(args);
  const segments = operation.path.segments.map((segment) => {
    const value = navigationValue(segment, values);
    if (segment.kind === "argument" && !safePathArgument(value)) {
      throw new TypeError("navigation path traversal was rejected");
    }
    return encodeComponent(value);
  });
  const pathname = `/${segments.join("/")}${operation.path.trailingSlash ? "/" : ""}`;
  const query = operation.query
    .map(
      ({ key, value }) =>
        `${encodeComponent(key)}=${encodeComponent(navigationValue(value, values))}`,
    )
    .join("&");
  const target = `${origin}${pathname}${query === "" ? "" : `?${query}`}`;
  if (Array.from(target).length > MAX_NAVIGATION_URL_CODE_POINTS) {
    throw new TypeError("navigation target was rejected");
  }
  const parsed = new URL(target);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError("navigation target was rejected");
  }
  return target;
}

function safePathArgument(value: string): boolean {
  return value !== "." && value !== ".." && !/[/?#]/u.test(value);
}

export function declarativeNavigationResult(
  url: string,
): DeclarativeNavigationResult {
  return Object.freeze({ state: "scheduled", url });
}

function readArguments(args: JsonObject): ReadonlyMap<string, string> {
  if (!isRecord(args))
    throw new TypeError("navigation arguments were rejected");
  const values = new Map<string, string>();
  for (const key of Reflect.ownKeys(args)) {
    if (typeof key !== "string") {
      throw new TypeError("navigation arguments were rejected");
    }
    const descriptor = Object.getOwnPropertyDescriptor(args, key);
    const value =
      descriptor !== undefined && "value" in descriptor
        ? descriptor.value
        : undefined;
    if (typeof value !== "string" || !safeDynamicValue(value)) {
      throw new TypeError("navigation arguments were rejected");
    }
    values.set(key, value);
  }
  return values;
}

function navigationValue(
  value: DeclarativeNavigateOperation["path"]["segments"][number],
  args: ReadonlyMap<string, string>,
): string {
  if (value.kind === "literal") return value.value;
  const argument = args.get(value.name);
  if (argument === undefined) {
    throw new TypeError("navigation argument was missing");
  }
  return argument;
}

function safeDynamicValue(value: string): boolean {
  return (
    value.length > 0 &&
    Array.from(value).length <= 256 &&
    !hasControl(value) &&
    !ABSOLUTE_OR_PROTOCOL_RELATIVE.test(value.trim()) &&
    !ENCODED_PATH_SYNTAX.test(value) &&
    !value.includes("\\")
  );
}

function hasControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function encodeComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalHttpsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("navigation origin was rejected");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError("navigation origin was rejected");
  }
  return parsed.origin;
}
