import { DeclarativePackBundleValidationError } from "./declarative-bundle-types.js";
import type { DeclarativePackBundleValidationCode } from "./declarative-bundle-types.js";

const MAX_ARRAY_ITEMS = 512;
const MAX_OBJECT_FIELDS = 256;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 8_192;
const MAX_STRING_BYTES = 16 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Parses JSON while retaining duplicate-key evidence and rejecting unsafe JSON. */
export function parseStrictJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new DeclarativePackBundleValidationError(issue("INVALID_JSON", "$"));
  }
  const parser = new Parser(text);
  const value = parser.value(0, "$");
  parser.whitespace();
  if (!parser.done()) parser.fail("INVALID_JSON", "$");
  return value;
}

class Parser {
  #index = 0;
  #nodes = 0;

  constructor(readonly text: string) {}

  value(depth: number, field: string): unknown {
    this.#nodes += 1;
    if (depth > MAX_JSON_DEPTH || this.#nodes > MAX_JSON_NODES) {
      this.fail("LIMIT_EXCEEDED", field);
    }
    this.whitespace();
    const character = this.text[this.#index];
    if (character === "{") return this.object(depth, field);
    if (character === "[") return this.array(depth, field);
    if (character === '"') return this.string(field);
    if (this.text.startsWith("true", this.#index)) {
      this.#index += 4;
      return true;
    }
    if (this.text.startsWith("false", this.#index)) {
      this.#index += 5;
      return false;
    }
    if (this.text.startsWith("null", this.#index)) {
      this.#index += 4;
      return null;
    }
    if (
      character === "-" ||
      (character !== undefined && /[0-9]/u.test(character))
    ) {
      return this.number(field);
    }
    this.fail("INVALID_JSON", field);
  }

  object(depth: number, field: string): Record<string, unknown> {
    this.#index += 1;
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.whitespace();
    if (this.take("}")) return result;
    while (true) {
      this.whitespace();
      if (this.text[this.#index] !== '"') this.fail("INVALID_JSON", field);
      const key = this.string(field + ".[key]");
      if (keys.has(key)) this.fail("DUPLICATE_KEY", field + "." + key);
      keys.add(key);
      if (keys.size > MAX_OBJECT_FIELDS) this.fail("LIMIT_EXCEEDED", field);
      this.whitespace();
      if (!this.take(":")) this.fail("INVALID_JSON", field);
      result[key] = this.value(depth + 1, field + "." + key);
      this.whitespace();
      if (this.take("}")) return result;
      if (!this.take(",")) this.fail("INVALID_JSON", field);
    }
  }

  array(depth: number, field: string): unknown[] {
    this.#index += 1;
    const result: unknown[] = [];
    this.whitespace();
    if (this.take("]")) return result;
    while (true) {
      if (result.length >= MAX_ARRAY_ITEMS) this.fail("LIMIT_EXCEEDED", field);
      result.push(this.value(depth + 1, field + "[" + result.length + "]"));
      this.whitespace();
      if (this.take("]")) return result;
      if (!this.take(",")) this.fail("INVALID_JSON", field);
    }
  }

  string(field: string): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.text.length) {
      const character = this.text[this.#index];
      if (character === '"') {
        this.#index += 1;
        const raw = this.text.slice(start, this.#index);
        let value: string;
        try {
          value = JSON.parse(raw) as string;
        } catch {
          this.fail("INVALID_JSON", field);
        }
        if (!isWellFormed(value) || hasNoncharacter(value)) {
          this.fail("INVALID_VALUE", field);
        }
        if (new TextEncoder().encode(value).byteLength > MAX_STRING_BYTES) {
          this.fail("LIMIT_EXCEEDED", field);
        }
        return value;
      }
      if (character === "\\") this.#index += 2;
      else if (character !== undefined && character < " ")
        this.fail("INVALID_JSON", field);
      else this.#index += 1;
    }
    this.fail("INVALID_JSON", field);
  }

  number(field: string): number {
    const match = this.text
      .slice(this.#index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (match === null) this.fail("INVALID_JSON", field);
    const token = match[0];
    this.#index += token.length;
    const value = Number(token);
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      this.fail("INVALID_VALUE", field);
    }
    return value;
  }

  whitespace(): void {
    while (
      this.text.charCodeAt(this.#index) === 9 ||
      this.text.charCodeAt(this.#index) === 10 ||
      this.text.charCodeAt(this.#index) === 13 ||
      this.text.charCodeAt(this.#index) === 32
    ) {
      this.#index += 1;
    }
  }

  take(value: string): boolean {
    if (!this.text.startsWith(value, this.#index)) return false;
    this.#index += value.length;
    return true;
  }

  done(): boolean {
    return this.#index === this.text.length;
  }

  fail(code: DeclarativePackBundleValidationCode, field: string): never {
    throw new DeclarativePackBundleValidationError(issue(code, field));
  }
}

function issue(
  code: DeclarativePackBundleValidationCode,
  field: string,
): {
  readonly code: DeclarativePackBundleValidationCode;
  readonly field: string;
} {
  return { code, field };
}

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasNoncharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
        (codePoint & 0xffff) >= 0xfffe)
    ) {
      return true;
    }
  }
  return false;
}
