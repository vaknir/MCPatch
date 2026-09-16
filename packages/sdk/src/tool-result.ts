import type { JsonValue } from "./types.js";

export const MAX_PACK_IMAGE_BYTES = 160 * 1024;
export const MAX_PACK_IMAGE_DIMENSION = 2_048;

export interface PackImageContent {
  readonly type: "image";
  readonly mimeType: "image/png" | "image/webp";
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

export interface PackExecutionResult<T extends JsonValue = JsonValue> {
  readonly result: T;
  readonly content: readonly [PackImageContent];
}

export type PackToolReturn<T extends JsonValue = JsonValue> =
  PackExecutionResult<T> | T;

const RESULTS = new WeakSet<object>();

/** Returns typed structured data plus one bounded MCP image content block. */
export function imageResult<T extends JsonValue>(
  result: T,
  image: PackImageContent,
): PackExecutionResult<T> {
  validateImage(image);
  const value = Object.freeze({
    result,
    content: Object.freeze([Object.freeze({ ...image })]) as readonly [
      PackImageContent,
    ],
  });
  RESULTS.add(value);
  return value;
}

export function isPackExecutionResult(
  value: unknown,
): value is PackExecutionResult {
  return typeof value === "object" && value !== null && RESULTS.has(value);
}

export function structuredResult<T extends JsonValue>(
  value: PackToolReturn<T>,
): T {
  return isPackExecutionResult(value) ? (value.result as T) : value;
}

function validateImage(image: PackImageContent): void {
  const keys =
    typeof image === "object" && image !== null ? Reflect.ownKeys(image) : [];
  if (
    keys.length !== 5 ||
    !["type", "mimeType", "data", "width", "height"].every((key) =>
      keys.includes(key),
    ) ||
    image.type !== "image" ||
    !["image/png", "image/webp"].includes(image.mimeType) ||
    !validDimension(image.width) ||
    !validDimension(image.height) ||
    !validBase64(image.data)
  ) {
    throw new TypeError("pack image result is invalid");
  }
}

function validDimension(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_PACK_IMAGE_DIMENSION
  );
}

function validBase64(value: string): boolean {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    return false;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding <= MAX_PACK_IMAGE_BYTES;
}
