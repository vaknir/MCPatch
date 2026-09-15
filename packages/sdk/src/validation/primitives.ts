import type {
  PackManifestValidationCode,
  PackManifestValidationIssue,
} from "../types.js";

export type RecordValue = Record<string, unknown>;

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 8_192;

export function validateJsonBounds(
  value: unknown,
): PackManifestValidationIssue | undefined {
  let nodes = 0;
  let bytes = 0;
  const stack: Array<{ depth: number; field: string; value: unknown }> = [
    { depth: 0, field: "$", value },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) {
      return issue("LIMIT_EXCEEDED", current.field);
    }
    if (typeof current.value === "string") {
      bytes += new TextEncoder().encode(current.value).length;
    } else if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        return issue("INVALID_VALUE", current.field);
      }
      bytes += 16;
    } else if (typeof current.value === "boolean" || current.value === null) {
      bytes += 5;
    } else if (Array.isArray(current.value)) {
      const array = current.value;
      for (let index = 0; index < array.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(array, index);
        if (descriptor === undefined || !("value" in descriptor)) {
          return issue("INVALID_TYPE", `${current.field}[${index}]`);
        }
        stack.push({
          depth: current.depth + 1,
          field: `${current.field}[${index}]`,
          value: descriptor.value,
        });
      }
      const unknown = Reflect.ownKeys(array).find((key) => {
        if (key === "length") return false;
        if (typeof key !== "string") return true;
        const index = Number(key);
        return (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= array.length ||
          String(index) !== key
        );
      });
      if (unknown !== undefined) {
        return issue("UNKNOWN_FIELD", `${current.field}.[array-property]`);
      }
    } else if (isRecord(current.value)) {
      for (const key of Reflect.ownKeys(current.value)) {
        if (typeof key !== "string") {
          return issue("UNKNOWN_FIELD", `${current.field}.[symbol]`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
        if (descriptor === undefined || !("value" in descriptor)) {
          return issue("INVALID_TYPE", `${current.field}.${key}`);
        }
        bytes += new TextEncoder().encode(key).length;
        stack.push({
          depth: current.depth + 1,
          field: `${current.field}.${key}`,
          value: descriptor.value,
        });
      }
    } else {
      return issue("INVALID_TYPE", current.field);
    }
    if (bytes > MAX_MANIFEST_BYTES) return issue("LIMIT_EXCEEDED", "$");
  }
  return undefined;
}

export function cloneAndFreeze(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item)));
  }
  if (!isRecord(value)) return value;

  const clone: RecordValue = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: true,
      value: cloneAndFreeze(child),
      writable: false,
    });
  }
  return Object.freeze(clone);
}

export function closedObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  field: string,
):
  | { value: RecordValue; issue?: undefined }
  | { value?: undefined; issue: PackManifestValidationIssue } {
  if (!isRecord(value)) return { issue: issue("INVALID_TYPE", field) };
  for (const name of required) {
    if (!Object.hasOwn(value, name)) {
      return { issue: issue("INVALID_VALUE", `${field}.${name}`) };
    }
  }
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).find((name) => !allowed.has(name));
  return unknown === undefined
    ? { value }
    : { issue: issue("UNKNOWN_FIELD", `${field}.${unknown}`) };
}

export function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): PackManifestValidationIssue | undefined {
  if (typeof value !== "string") return issue("INVALID_TYPE", field);
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum
    ? undefined
    : issue("LIMIT_EXCEEDED", field);
}

export function boundedPattern(
  value: unknown,
  minimum: number,
  maximum: number,
  pattern: RegExp,
  field: string,
): PackManifestValidationIssue | undefined {
  const textIssue = boundedText(value, minimum, maximum, field);
  if (textIssue !== undefined) return textIssue;
  return pattern.test(value as string)
    ? undefined
    : issue("INVALID_IDENTIFIER", field);
}

export function validPattern(
  value: unknown,
  pattern: RegExp,
  code: PackManifestValidationCode,
  field: string,
  maximum = 128,
): PackManifestValidationIssue | undefined {
  return typeof value === "string" &&
    value.length <= maximum &&
    pattern.test(value)
    ? undefined
    : issue(code, field);
}

export function boundedArray(
  value: unknown,
  minimum: number,
  maximum: number,
): value is unknown[] {
  return (
    Array.isArray(value) && value.length >= minimum && value.length <= maximum
  );
}

export function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

export function compareStableVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(BigInt);
  const rightParts = right.split(".").map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined || rightPart === undefined) return 0;
    const difference = leftPart - rightPart;
    if (difference !== 0n) return difference < 0n ? -1 : 1;
  }
  return 0;
}

export function isRecord(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function isAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

export function issue(
  code: PackManifestValidationCode,
  field: string,
): PackManifestValidationIssue {
  return { code, field };
}
