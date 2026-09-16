import type { JsonValue } from "./types.js";
import {
  validateDescendantScope,
  validateLocator,
  validateScope,
} from "./declarative-operations-locators.js";
import { validateProjection } from "./declarative-operations-projections.js";
import type {
  DeclarativeAriaRole,
  DeclarativeHtmlTag,
  DeclarativeLocator,
  DeclarativeLocatorAttribute,
  DeclarativeProjection,
  DeclarativeSafeAttribute,
  DeclarativeScalarSource,
  DeclarativeScope,
} from "./declarative-operations-types.js";
import { DeclarativePackBundleValidationError } from "./declarative-bundle-types.js";
import { bundleIssue } from "./declarative-bundle-limits.js";
import {
  cloneAndFreeze,
  isRecord,
  validateJsonBounds,
} from "./validation/primitives.js";

declare const LOCATOR_BRAND: unique symbol;
declare const SCOPE_BRAND: unique symbol;
declare const PROJECTION_BRAND: unique symbol;
declare const SOURCE_BRAND: unique symbol;

export interface LocatorBuilder {
  readonly [LOCATOR_BRAND]: true;
}

export interface ScopeBuilder {
  readonly [SCOPE_BRAND]: true;
}

export interface ProjectionBuilder<TValue extends JsonValue = JsonValue> {
  readonly [PROJECTION_BRAND]: TValue;
}

export interface ScalarSourceBuilder {
  readonly [SOURCE_BRAND]: true;
}

const locatorNodes = new WeakMap<object, DeclarativeLocator>();
const scopeNodes = new WeakMap<object, DeclarativeScope>();
const projectionNodes = new WeakMap<object, DeclarativeProjection>();
const sourceNodes = new WeakMap<object, DeclarativeScalarSource>();

export const locator = Object.freeze({
  role(
    role: DeclarativeAriaRole,
    options: Readonly<{ readonly name?: string }> = {},
  ): LocatorBuilder {
    const checked = exactDataObject(options, ["name"], "locator.role");
    return locatorBuilder({
      kind: "role",
      role,
      ...(Object.hasOwn(checked, "name")
        ? { name: checked.name as string }
        : {}),
    });
  },

  selector(
    options: Readonly<{
      readonly tag?: DeclarativeHtmlTag;
      readonly id?: string;
      readonly classes?: readonly string[];
      readonly attributes?: readonly Readonly<{
        readonly name: DeclarativeLocatorAttribute;
        readonly value: string;
      }>[];
    }>,
  ): LocatorBuilder {
    const checked = exactDataObject(
      options,
      ["tag", "id", "classes", "attributes"],
      "locator.selector",
    );
    return locatorBuilder({ kind: "selector", ...checked });
  },
});

export const scope = Object.freeze({
  single(value: LocatorBuilder): ScopeBuilder {
    return scopeBuilder({ kind: "single", locator: locatorNode(value) });
  },

  list(
    value: LocatorBuilder,
    options: Readonly<{ readonly maxMatches: number }>,
  ): ScopeBuilder {
    const checked = exactDataObject(options, ["maxMatches"], "scope.list");
    return scopeBuilder({
      kind: "list",
      locator: locatorNode(value),
      maxMatches: checked.maxMatches as number,
    });
  },
});

export const scalar = Object.freeze({
  text(): ScalarSourceBuilder {
    return sourceBuilder({ kind: "text" });
  },

  attribute(name: DeclarativeSafeAttribute): ScalarSourceBuilder {
    return sourceBuilder({ kind: "attribute", name });
  },
});

export const projection = Object.freeze({
  text(): ProjectionBuilder<string> {
    return projectionBuilder({ kind: "text" });
  },

  attribute(name: DeclarativeSafeAttribute): ProjectionBuilder<string> {
    return projectionBuilder({ kind: "attribute", name });
  },

  constant<const TValue extends JsonValue>(
    value: TValue,
  ): ProjectionBuilder<TValue> {
    return projectionBuilder({ kind: "constant", value });
  },

  number(sourceValue: ScalarSourceBuilder): ProjectionBuilder<number> {
    return projectionBuilder({
      kind: "number",
      source: sourceNode(sourceValue),
    });
  },

  percentage(sourceValue: ScalarSourceBuilder): ProjectionBuilder<number> {
    return projectionBuilder({
      kind: "percentage",
      source: sourceNode(sourceValue),
    });
  },

  boolean(sourceValue: ScalarSourceBuilder): ProjectionBuilder<boolean> {
    return projectionBuilder({
      kind: "boolean",
      source: sourceNode(sourceValue),
    });
  },

  optional<TValue extends JsonValue>(
    value: ProjectionBuilder<TValue>,
  ): ProjectionBuilder<TValue | null> {
    return projectionBuilder({
      kind: "optional",
      value: projectionNode(value),
    });
  },

  descendant<TValue extends JsonValue>(
    scopeValue: ScopeBuilder,
    value: ProjectionBuilder<TValue>,
  ): ProjectionBuilder<TValue | readonly TValue[]> {
    const scopeNodeValue = scopeNode(scopeValue);
    return projectionBuilder({
      kind: "descendant",
      scope: scopeNodeValue,
      projection: projectionNode(value),
    });
  },

  object<const TFields extends Readonly<Record<string, ProjectionBuilder>>>(
    fields: TFields,
  ): ProjectionBuilder<{
    readonly [TKey in keyof TFields]: TFields[TKey] extends ProjectionBuilder<
      infer TValue
    >
      ? TValue
      : never;
  }> {
    if (!isRecord(fields)) invalid("projection.object");
    const output = Reflect.ownKeys(fields)
      .map((key) => {
        if (typeof key !== "string") invalid("projection.object");
        const descriptor = Object.getOwnPropertyDescriptor(fields, key);
        if (descriptor === undefined || !("value" in descriptor)) {
          invalid("projection.object");
        }
        return { key, value: projectionNode(descriptor.value) };
      })
      .sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      );
    return projectionBuilder({ kind: "object", fields: output }) as never;
  },

  array<const TItems extends readonly ProjectionBuilder[]>(
    items: TItems,
  ): ProjectionBuilder<{
    readonly [TIndex in keyof TItems]: TItems[TIndex] extends ProjectionBuilder<
      infer TValue
    >
      ? TValue
      : never;
  }> {
    if (!Array.isArray(items)) invalid("projection.array");
    const output: DeclarativeProjection[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(items, index);
      if (descriptor === undefined || !("value" in descriptor)) {
        invalid("projection.array");
      }
      output.push(projectionNode(descriptor.value));
    }
    const unknown = Reflect.ownKeys(items).some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" ||
          !Number.isSafeInteger(Number(key)) ||
          String(Number(key)) !== key),
    );
    if (unknown) invalid("projection.array");
    return projectionBuilder({ kind: "array", items: output }) as never;
  },
});

export function unwrapLocator(value: LocatorBuilder): DeclarativeLocator {
  return locatorNode(value);
}

export function unwrapScope(value: ScopeBuilder): DeclarativeScope {
  return scopeNode(value);
}

export function unwrapProjection(
  value: ProjectionBuilder,
): DeclarativeProjection {
  return projectionNode(value);
}

function locatorBuilder(node: DeclarativeLocator): LocatorBuilder {
  assertBuilderData(node, "locator");
  const issue = validateLocator(node, "locator");
  if (issue !== undefined)
    throw new DeclarativePackBundleValidationError(issue);
  return branded(locatorNodes, node) as LocatorBuilder;
}

function scopeBuilder(node: DeclarativeScope): ScopeBuilder {
  assertBuilderData(node, "scope");
  const issue = validateScope(node, "scope");
  if (issue !== undefined)
    throw new DeclarativePackBundleValidationError(issue);
  return branded(scopeNodes, node) as ScopeBuilder;
}

function projectionBuilder<TValue extends JsonValue>(
  node: DeclarativeProjection,
): ProjectionBuilder<TValue> {
  assertBuilderData(node, "projection");
  const issue = validateProjection(node, "projection", 1);
  if (issue !== undefined)
    throw new DeclarativePackBundleValidationError(issue);
  return branded(projectionNodes, node) as ProjectionBuilder<TValue>;
}

function sourceBuilder(node: DeclarativeScalarSource): ScalarSourceBuilder {
  assertBuilderData(node, "source");
  const projectionIssue = validateProjection(
    { kind: "number", source: node },
    "source",
    1,
  );
  if (projectionIssue !== undefined) {
    throw new DeclarativePackBundleValidationError(projectionIssue);
  }
  return branded(sourceNodes, node) as ScalarSourceBuilder;
}

function branded<TNode>(map: WeakMap<object, TNode>, node: TNode): object {
  const wrapper = Object.freeze({});
  map.set(wrapper, cloneAndFreeze(node) as TNode);
  return wrapper;
}

function locatorNode(value: unknown): DeclarativeLocator {
  return brandedNode(locatorNodes, value, "locator");
}

function scopeNode(value: unknown): DeclarativeScope {
  const node = brandedNode(scopeNodes, value, "scope");
  const issue = validateDescendantScope(node, "scope");
  if (issue !== undefined)
    throw new DeclarativePackBundleValidationError(issue);
  return node;
}

function projectionNode(value: unknown): DeclarativeProjection {
  return brandedNode(projectionNodes, value, "projection");
}

function sourceNode(value: unknown): DeclarativeScalarSource {
  return brandedNode(sourceNodes, value, "source");
}

function brandedNode<TNode>(
  map: WeakMap<object, TNode>,
  value: unknown,
  field: string,
): TNode {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    invalid(field);
  }
  const node = map.get(value as object);
  if (node === undefined) invalid(field);
  return node;
}

function exactDataObject(
  value: unknown,
  allowedFields: readonly string[],
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) invalid(field);
  const output: Record<string, unknown> = {};
  const allowed = new Set(allowedFields);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) invalid(field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) invalid(field);
    output[key] = descriptor.value;
  }
  return output;
}

function invalid(field: string): never {
  throw new DeclarativePackBundleValidationError(
    bundleIssue("INVALID_TYPE", field),
  );
}

function assertBuilderData(value: unknown, field: string): void {
  if (validateJsonBounds(value) !== undefined) invalid(field);
}
