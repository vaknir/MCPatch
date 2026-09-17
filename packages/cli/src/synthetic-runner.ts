import {
  createDeclarativeNavigationUrl,
  declarativeNavigationResult,
  MAX_ATTRIBUTE_CHARS,
  MAX_NODE_VISITS,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_NODES,
  MAX_TEXT_CHARS,
  type DeclarativeLocator,
  type DeclarativeProjection,
  type DeclarativeScalarSource,
  type DeclarativeScope,
  type JsonValue,
} from "@mcpatch/sdk";
import type {
  DeclarativeFixtureRunRequest,
  DeclarativeFixtureRunner,
} from "@mcpatch/sdk/declarative-fixtures";
import type { SyntheticDocumentElement } from "@mcpatch/sdk/declarative";

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const PERCENTAGE = /^(?:0|[1-9]\d*)(?:\.\d+)?%?$/u;

class SyntheticExecutionError extends Error {
  constructor(readonly code: string) {
    super(`synthetic execution failed: ${code}`);
    this.name = "SyntheticExecutionError";
  }
}

/** Deterministic, browser-free implementation of declarative fixture semantics. */
export const syntheticFixtureRunner: DeclarativeFixtureRunner = Object.freeze({
  run(request: DeclarativeFixtureRunRequest) {
    return runSyntheticFixture(request);
  },
});

export function runSyntheticFixture(
  request: DeclarativeFixtureRunRequest,
): JsonValue {
  if (request.kind === "navigate") {
    return declarativeNavigationResult(
      createDeclarativeNavigationUrl(
        request.operation,
        request.args,
        request.currentOrigin,
      ),
    );
  }
  const { operation } = request;
  if (
    locate(
      [request.document.root],
      operation.availability.locator,
      1,
      new FixtureBudget(),
    ).length === 0
  ) {
    fail("CAPABILITY_UNAVAILABLE");
  }
  const budget = new FixtureBudget();
  const result = executeScope(
    [request.document.root],
    operation.scope,
    operation.projection,
    budget,
  );
  budget.output(result);
  return result;
}

function executeScope(
  roots: readonly SyntheticDocumentElement[],
  scopeValue: DeclarativeScope,
  projectionValue: DeclarativeProjection,
  budget: FixtureBudget,
): JsonValue {
  const maximum = scopeValue.kind === "single" ? 2 : scopeValue.maxMatches + 1;
  const matches = locate(roots, scopeValue.locator, maximum, budget);
  if (scopeValue.kind === "single") {
    if (matches.length === 0) fail("CAPABILITY_UNAVAILABLE");
    if (matches.length !== 1) fail("CARDINALITY_EXCEEDED");
    return project(
      matches[0] as SyntheticDocumentElement,
      projectionValue,
      budget,
    );
  }
  if (matches.length > scopeValue.maxMatches) fail("CARDINALITY_EXCEEDED");
  return matches.map((node) => project(node, projectionValue, budget));
}

function project(
  node: SyntheticDocumentElement,
  value: DeclarativeProjection,
  budget: FixtureBudget,
): JsonValue {
  switch (value.kind) {
    case "text":
      return readText(node);
    case "attribute":
      return readAttribute(node, value.name);
    case "constant":
      return value.value;
    case "number":
      return parseNumber(readSource(node, value.source));
    case "percentage":
      return parsePercentage(readSource(node, value.source));
    case "boolean":
      return parseBoolean(readSource(node, value.source));
    case "optional":
      try {
        return project(node, value.value, budget);
      } catch (error) {
        if (
          error instanceof SyntheticExecutionError &&
          error.code === "PROJECTION_ABSENT"
        ) {
          return null;
        }
        throw error;
      }
    case "descendant": {
      const children = node.children ?? [];
      const maximum =
        value.scope.kind === "single"
          ? 2
          : (value.scope.maxMatches as number) + 1;
      const matches = locate(children, value.scope.locator, maximum, budget);
      if (value.scope.kind === "single") {
        if (matches.length === 0) fail("PROJECTION_ABSENT");
        if (matches.length !== 1) fail("CARDINALITY_EXCEEDED");
        return project(
          matches[0] as SyntheticDocumentElement,
          value.projection,
          budget,
        );
      }
      if (matches.length > (value.scope.maxMatches as number)) {
        fail("CARDINALITY_EXCEEDED");
      }
      return matches.map((child) => project(child, value.projection, budget));
    }
    case "object": {
      const output: Record<string, JsonValue> = Object.create(null) as Record<
        string,
        JsonValue
      >;
      for (const field of value.fields) {
        Object.defineProperty(output, field.key, {
          enumerable: true,
          value: project(node, field.value, budget),
        });
      }
      return output;
    }
    case "array":
      return value.items.map((item) => project(node, item, budget));
  }
}

function locate(
  roots: readonly SyntheticDocumentElement[],
  locator: DeclarativeLocator,
  maximum: number,
  budget: FixtureBudget,
): readonly SyntheticDocumentElement[] {
  const stack = [...roots].reverse();
  const matches: SyntheticDocumentElement[] = [];
  while (stack.length > 0 && matches.length < maximum) {
    const node = stack.pop();
    if (node === undefined) break;
    budget.visit();
    if (matchesLocator(node, locator)) matches.push(node);
    stack.push(...[...(node.children ?? [])].reverse());
  }
  return matches;
}

function matchesLocator(
  node: SyntheticDocumentElement,
  locator: DeclarativeLocator,
): boolean {
  if (locator.kind === "role") {
    return (
      role(node) === locator.role &&
      (locator.name === undefined || accessibleName(node) === locator.name)
    );
  }
  return (
    (locator.tag === undefined || node.tag === locator.tag) &&
    (locator.id === undefined || node.id === locator.id) &&
    (locator.classes === undefined ||
      locator.classes.every((className) =>
        node.classes?.includes(className),
      )) &&
    (locator.attributes === undefined ||
      locator.attributes.every(
        (attribute) => attributeValue(node, attribute.name) === attribute.value,
      ))
  );
}

function role(node: SyntheticDocumentElement): string | undefined {
  if (node.role !== undefined) return node.role;
  switch (node.tag) {
    case "a":
      return attributeValue(node, "href") === undefined ? undefined : "link";
    case "article":
      return "article";
    case "button":
      return "button";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "img":
      return "img";
    case "li":
      return "listitem";
    case "main":
      return "main";
    case "nav":
      return "navigation";
    case "ol":
    case "ul":
      return "list";
    case "option":
      return "option";
    case "table":
      return "table";
    case "td":
      return "cell";
    case "textarea":
      return "textbox";
    case "th":
      return "columnheader";
    case "tr":
      return "row";
    case "select":
      return "combobox";
    default:
      return undefined;
  }
}

function accessibleName(node: SyntheticDocumentElement): string {
  return (
    node.accessibleName ??
    node.attributes?.["aria-label"] ??
    node.attributes?.alt ??
    node.attributes?.title ??
    readText(node)
  );
}

function readSource(
  node: SyntheticDocumentElement,
  source: DeclarativeScalarSource,
): string {
  return source.kind === "text"
    ? readText(node)
    : readAttribute(node, source.name);
}

function readText(node: SyntheticDocumentElement): string {
  let result = node.text ?? "";
  for (const child of node.children ?? []) result += readText(child);
  if (Array.from(result).length > MAX_TEXT_CHARS) fail("TEXT_LIMIT_EXCEEDED");
  return result;
}

function readAttribute(node: SyntheticDocumentElement, name: string): string {
  const value = attributeValue(node, name);
  if (value === undefined) fail("PROJECTION_ABSENT");
  if (Array.from(value).length > MAX_ATTRIBUTE_CHARS) {
    fail("ATTRIBUTE_LIMIT_EXCEEDED");
  }
  return value;
}

function attributeValue(
  node: SyntheticDocumentElement,
  name: string,
): string | undefined {
  if (name === "id") return node.id;
  if (name === "role") return node.role;
  return node.attributes?.[name];
}

function parseNumber(value: string): number {
  if (!NUMBER.test(value)) fail("INVALID_PAGE_VALUE");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    fail("INVALID_PAGE_VALUE");
  }
  return parsed;
}

function parsePercentage(value: string): number {
  if (!PERCENTAGE.test(value)) fail("INVALID_PAGE_VALUE");
  const parsed = Number(value.endsWith("%") ? value.slice(0, -1) : value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    fail("INVALID_PAGE_VALUE");
  }
  return parsed;
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  fail("INVALID_PAGE_VALUE");
}

class FixtureBudget {
  #visits = 0;

  visit(): void {
    this.#visits += 1;
    if (this.#visits > MAX_NODE_VISITS) fail("NODE_VISIT_LIMIT_EXCEEDED");
  }

  output(value: JsonValue): void {
    let nodes = 0;
    const stack: unknown[] = [value];
    while (stack.length > 0) {
      const current = stack.pop();
      nodes += 1;
      if (nodes > MAX_OUTPUT_NODES) fail("OUTPUT_LIMIT_EXCEEDED");
      if (Array.isArray(current)) stack.push(...current);
      else if (typeof current === "object" && current !== null) {
        stack.push(...Object.values(current));
      }
    }
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MAX_OUTPUT_BYTES
    ) {
      fail("OUTPUT_LIMIT_EXCEEDED");
    }
  }
}

function fail(code: string): never {
  throw new SyntheticExecutionError(code);
}
