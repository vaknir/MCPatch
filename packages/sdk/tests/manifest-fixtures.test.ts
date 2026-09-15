import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { parsePackManifest, validatePackManifest } from "../src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const validDirectory = join(root, "fixtures/v1/valid");
const invalidCases = readJson(
  join(root, "fixtures/v1/invalid/cases.json"),
) as InvalidCase[];
const invalidBase = readJson(join(validDirectory, "bundled-demo.json"));
const schema = readJson(join(root, "schema/v1/pack-manifest.schema.json"));
const validateSchema = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(schema as AnySchema);

const validFixtures = fixtureNames(validDirectory);

describe("Pack Manifest v1 golden fixtures", () => {
  it("covers declarative and bundled execution tiers", () => {
    const kinds = validFixtures
      .map((name) => readJson(join(validDirectory, name)))
      .map((value) => (value as { execution: { kind: string } }).execution.kind)
      .sort();
    expect(kinds).toEqual(["bundled", "declarative"]);
  });

  it.each(validFixtures)(
    "accepts %s through schema and runtime validation",
    (name) => {
      const value = readJson(join(validDirectory, name));
      expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(
        true,
      );
      expect(validatePackManifest(value)).toBeUndefined();
      expect(parsePackManifest(value)).toEqual(value);
    },
  );

  it.each(invalidCases)("rejects $name deterministically", (testCase) => {
    const candidate = structuredClone(invalidBase);
    for (const operation of operations(testCase)) apply(candidate, operation);
    expect(validateSchema(candidate)).toBe(testCase.schemaValid);
    expect(validatePackManifest(candidate)).toEqual(testCase.issue);
  });
});

interface InvalidCase {
  readonly name: string;
  readonly operation?: Operation;
  readonly operations?: readonly Operation[];
  readonly schemaValid: boolean;
  readonly issue: { readonly code: string; readonly field: string };
}

type Operation =
  | { readonly kind: "copy"; readonly from: string; readonly path: string }
  | { readonly kind: "remove"; readonly path: string }
  | { readonly kind: "set"; readonly path: string; readonly value: unknown };

function operations(testCase: InvalidCase): readonly Operation[] {
  if (testCase.operations !== undefined) return testCase.operations;
  if (testCase.operation !== undefined) return [testCase.operation];
  throw new Error(`Invalid case ${testCase.name} has no operation`);
}

function apply(target: unknown, operation: Operation): void {
  const segments = pointerSegments(operation.path);
  const key = segments.pop();
  if (key === undefined) throw new Error("Cannot mutate the document root");
  const parent = locate(target, segments);

  if (operation.kind === "remove") {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else Reflect.deleteProperty(parent as Record<string, unknown>, key);
    return;
  }
  const value =
    operation.kind === "copy"
      ? structuredClone(locate(target, pointerSegments(operation.from)))
      : operation.value;
  if (Array.isArray(parent)) {
    if (key === "-") parent.push(value);
    else parent[Number(key)] = value;
  } else {
    (parent as Record<string, unknown>)[key] = value;
  }
}

function locate(target: unknown, segments: readonly string[]): unknown {
  let current = target;
  for (const segment of segments) {
    current = Array.isArray(current)
      ? current[Number(segment)]
      : (current as Record<string, unknown>)[segment];
  }
  return current;
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith("/"))
    throw new Error(`Invalid JSON pointer ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function fixtureNames(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
}
