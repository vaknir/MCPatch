import { DeclarativePackBundleValidationError } from "./declarative-bundle-types.js";
import type { DeclarativePackBundleValidationCode } from "./declarative-bundle-types.js";
import {
  MAX_BUNDLE_ARRAY_ITEMS,
  MAX_BUNDLE_JSON_DEPTH,
  MAX_BUNDLE_JSON_NODES,
  MAX_BUNDLE_OBJECT_FIELDS,
  MAX_BUNDLE_STRING_BYTES,
  bundleIssue,
  hasNoncharacter,
  isWellFormed,
} from "./declarative-bundle-limits.js";
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Parses JSON while retaining duplicate-key evidence and rejecting unsafe JSON. */
export function parseStrictJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new DeclarativePackBundleValidationError(
      bundleIssue("INVALID_JSON", "$"),
    );
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
    if (depth > MAX_BUNDLE_JSON_DEPTH || this.#nodes > MAX_BUNDLE_JSON_NODES) {
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
      if (keys.has(key)) this.fail("DUPLICATE_KEY", field);
      keys.add(key);
      if (keys.size > MAX_BUNDLE_OBJECT_FIELDS)
        this.fail("LIMIT_EXCEEDED", field);
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
      if (result.length >= MAX_BUNDLE_ARRAY_ITEMS)
        this.fail("LIMIT_EXCEEDED", field);
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
        if (
          new TextEncoder().encode(value).byteLength > MAX_BUNDLE_STRING_BYTES
        ) {
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
    const safeField =
      code === "DUPLICATE_KEY" || code === "UNKNOWN_FIELD"
        ? "$"
        : field === "$"
          ? "$"
          : "bundle";
    throw new DeclarativePackBundleValidationError(
      bundleIssue(code, safeField),
    );
  }
}
