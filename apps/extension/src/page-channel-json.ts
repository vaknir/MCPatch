import {
  MAX_PAGE_FRAME_BYTES,
  PageProtocolValidationError,
} from "./page-channel-types.js";

const MAX_DEPTH = 32;
const MAX_NODES = 8_192;
const MAX_ARRAY_ITEMS = 512;
const MAX_OBJECT_FIELDS = 256;
const MAX_STRING_LENGTH = 65_536;
const NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/** Parses one bounded JSON text frame while rejecting duplicate object keys. */
export function parseBoundedJsonFrame(frame: unknown): unknown {
  if (typeof frame !== "string") {
    throw new PageProtocolValidationError("INVALID_TYPE", "$frame");
  }
  if (new TextEncoder().encode(frame).byteLength > MAX_PAGE_FRAME_BYTES) {
    throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
  }
  return new BoundedJsonParser(frame).parse();
}

/** Copies untrusted data without invoking accessors and emits bounded JSON text. */
export function encodeBoundedJsonFrame(value: unknown): string {
  const clone = copyJsonData(value, 0, { nodes: 0 });
  const frame = JSON.stringify(clone);
  if (new TextEncoder().encode(frame).byteLength > MAX_PAGE_FRAME_BYTES) {
    throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
  }
  return frame;
}

class BoundedJsonParser {
  readonly #text: string;
  #index = 0;
  #nodes = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): unknown {
    this.#skipWhitespace();
    if (this.#index === this.#text.length) this.#malformed();
    const result = this.#value(0);
    this.#skipWhitespace();
    if (this.#index !== this.#text.length) this.#malformed();
    return result;
  }

  #value(depth: number): unknown {
    this.#nodes += 1;
    if (depth > MAX_DEPTH || this.#nodes > MAX_NODES) {
      throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
    }
    switch (this.#text[this.#index]) {
      case "{":
        return this.#object(depth);
      case "[":
        return this.#array(depth);
      case '"':
        return this.#string();
      case "t":
        return this.#literal("true", true);
      case "f":
        return this.#literal("false", false);
      case "n":
        return this.#literal("null", null);
      default:
        return this.#number();
    }
  }

  #object(depth: number): Readonly<Record<string, unknown>> {
    this.#index += 1;
    this.#skipWhitespace();
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (this.#consume("}")) return Object.freeze(result);
    while (true) {
      if (this.#text[this.#index] !== '"') this.#malformed();
      const key = this.#string();
      if (Array.from(key).length > 256) {
        throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
      }
      if (keys.has(key)) {
        throw new PageProtocolValidationError("DUPLICATE_FIELD", key);
      }
      keys.add(key);
      if (keys.size > MAX_OBJECT_FIELDS) {
        throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
      }
      this.#skipWhitespace();
      if (!this.#consume(":")) this.#malformed();
      this.#skipWhitespace();
      result[key] = this.#value(depth + 1);
      this.#skipWhitespace();
      if (this.#consume("}")) return Object.freeze(result);
      if (!this.#consume(",")) this.#malformed();
      this.#skipWhitespace();
    }
  }

  #array(depth: number): readonly unknown[] {
    this.#index += 1;
    this.#skipWhitespace();
    const result: unknown[] = [];
    if (this.#consume("]")) return Object.freeze(result);
    while (true) {
      if (result.length >= MAX_ARRAY_ITEMS) {
        throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
      }
      result.push(this.#value(depth + 1));
      this.#skipWhitespace();
      if (this.#consume("]")) return Object.freeze(result);
      if (!this.#consume(",")) this.#malformed();
      this.#skipWhitespace();
    }
  }

  #string(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#text.length) {
      const character = this.#text[this.#index];
      if (character === '"') {
        this.#index += 1;
        let value: unknown;
        try {
          value = JSON.parse(this.#text.slice(start, this.#index)) as unknown;
        } catch {
          return this.#malformed();
        }
        if (
          typeof value !== "string" ||
          Array.from(value).length > MAX_STRING_LENGTH
        ) {
          throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
        }
        return value;
      }
      if (character === "\\") {
        this.#index += 2;
      } else {
        this.#index += 1;
      }
    }
    return this.#malformed();
  }

  #number(): number {
    const match = NUMBER_TOKEN.exec(this.#text.slice(this.#index));
    if (match === null) return this.#malformed();
    this.#index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.#malformed();
    return value;
  }

  #literal<T>(token: string, value: T): T {
    if (!this.#text.startsWith(token, this.#index)) this.#malformed();
    this.#index += token.length;
    return value;
  }

  #consume(token: string): boolean {
    if (this.#text[this.#index] !== token) return false;
    this.#index += 1;
    return true;
  }

  #skipWhitespace(): void {
    while (
      this.#text[this.#index] === " " ||
      this.#text[this.#index] === "\t" ||
      this.#text[this.#index] === "\n" ||
      this.#text[this.#index] === "\r"
    ) {
      this.#index += 1;
    }
  }

  #malformed(): never {
    throw new PageProtocolValidationError("MALFORMED_JSON", "$frame");
  }
}

function copyJsonData(
  value: unknown,
  depth: number,
  state: { nodes: number },
): unknown {
  state.nodes += 1;
  if (depth > MAX_DEPTH || state.nodes > MAX_NODES) {
    throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (
      typeof value === "string" &&
      Array.from(value).length > MAX_STRING_LENGTH
    ) {
      throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PageProtocolValidationError("INVALID_VALUE", "$frame");
    }
    return value;
  }
  if (Array.isArray(value)) return copyArray(value, depth, state);
  if (!isDataObject(value)) {
    throw new PageProtocolValidationError("INVALID_TYPE", "$frame");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_OBJECT_FIELDS) {
    throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || Array.from(key).length > 256) {
      throw new PageProtocolValidationError("INVALID_VALUE", "$frame");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new PageProtocolValidationError("INVALID_VALUE", "$frame");
    }
    result[key] = copyJsonData(descriptor.value, depth + 1, state);
  }
  return Object.freeze(result);
}

function copyArray(
  value: readonly unknown[],
  depth: number,
  state: { nodes: number },
): readonly unknown[] {
  const keys = Reflect.ownKeys(value);
  if (value.length > MAX_ARRAY_ITEMS) {
    throw new PageProtocolValidationError("LIMIT_EXCEEDED", "$frame");
  }
  if (keys.length !== value.length + 1) {
    throw new PageProtocolValidationError("INVALID_VALUE", "$frame");
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new PageProtocolValidationError("INVALID_VALUE", "$frame");
    }
    result.push(copyJsonData(descriptor.value, depth + 1, state));
  }
  return Object.freeze(result);
}

function isDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
