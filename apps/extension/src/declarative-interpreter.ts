import type { JsonObject, JsonValue } from "@mcpatch/protocol";
import type {
  DeclarativeProjection,
  DeclarativeReadOperation,
  DeclarativeScalarSource,
  DeclarativeScope,
} from "@mcpatch/sdk/runtime";

import type {
  DeclarativeDocumentAdapter,
  DeclarativeNodeHandle,
} from "./declarative-document-model.js";
import { DeclarativeRuntimeError } from "./declarative-document-model.js";
import type { DeclarativeExecutionBudget } from "./declarative-execution-budget.js";
import { matchesDeclarativeOutputSchema } from "./declarative-output-schema.js";

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const PERCENTAGE = /^(?:0|[1-9]\d*)(?:\.\d+)?%?$/u;

export async function discoverDeclarativeOperation(
  operation: DeclarativeReadOperation,
  adapter: DeclarativeDocumentAdapter,
  budget: DeclarativeExecutionBudget,
): Promise<boolean> {
  const located = await adapterCall(budget, () =>
    adapter.locate(
      undefined,
      operation.availability.locator,
      { maxMatches: 1, maxVisits: budget.remainingVisits },
      budget.signal,
    ),
  );
  budget.consumeVisits(located.visited, located.visitLimitExceeded);
  budget.check();
  return located.handles.length === 1;
}

export async function executeDeclarativeOperation(
  operation: DeclarativeReadOperation,
  outputSchema: JsonObject,
  adapter: DeclarativeDocumentAdapter,
  budget: DeclarativeExecutionBudget,
): Promise<JsonValue> {
  const result = await executeScope(operation.scope, operation.projection);
  validateOutputBounds(result, budget);
  if (!matchesDeclarativeOutputSchema(outputSchema, result)) {
    throw new DeclarativeRuntimeError("RESULT_INVALID");
  }
  return freezeOutput(result);

  async function executeScope(
    scope: DeclarativeScope,
    projection: DeclarativeProjection,
  ): Promise<JsonValue> {
    const handles = await locate(
      undefined,
      scope.locator,
      scope.kind === "single" ? 1 : scope.maxMatches,
    );
    if (scope.kind === "single") {
      const handle = handles[0];
      if (handle === undefined) {
        throw new DeclarativeRuntimeError("CAPABILITY_UNAVAILABLE");
      }
      return project(handle, projection);
    }
    budget.consumeArrayContainer(handles.length);
    const values: JsonValue[] = [];
    for (const handle of handles)
      values.push(await project(handle, projection));
    return values;
  }

  async function project(
    handle: DeclarativeNodeHandle,
    projection: DeclarativeProjection,
  ): Promise<JsonValue> {
    budget.check();
    switch (projection.kind) {
      case "text":
        return chargeScalar(await readText(handle));
      case "attribute":
        return chargeScalar(await readAttribute(handle, projection.name));
      case "constant":
        budget.consumeConstant(projection.value);
        return projection.value;
      case "number":
        return chargeScalar(
          parseNumber(await readSource(handle, projection.source)),
        );
      case "percentage":
        return chargeScalar(
          parsePercentage(await readSource(handle, projection.source)),
        );
      case "boolean":
        return chargeScalar(
          parseBoolean(await readSource(handle, projection.source)),
        );
      case "optional":
        try {
          return await project(handle, projection.value);
        } catch (error) {
          if (
            error instanceof DeclarativeRuntimeError &&
            error.code === "PROJECTION_ABSENT"
          ) {
            budget.consumeScalar(null);
            return null;
          }
          throw error;
        }
      case "descendant": {
        const maximum =
          projection.scope.kind === "single"
            ? 1
            : (projection.scope.maxMatches ?? 0);
        const handles = await locate(handle, projection.scope.locator, maximum);
        if (projection.scope.kind === "single") {
          const child = handles[0];
          if (child === undefined) {
            throw new DeclarativeRuntimeError("PROJECTION_ABSENT");
          }
          return project(child, projection.projection);
        }
        budget.consumeArrayContainer(handles.length);
        const values: JsonValue[] = [];
        for (const child of handles) {
          values.push(await project(child, projection.projection));
        }
        return values;
      }
      case "object": {
        budget.consumeObjectContainer(
          projection.fields.map((field) => field.key),
        );
        const object: Record<string, JsonValue> = Object.create(null);
        for (const field of projection.fields) {
          Object.defineProperty(object, field.key, {
            enumerable: true,
            value: await project(handle, field.value),
          });
        }
        return object;
      }
      case "array": {
        budget.consumeArrayContainer(projection.items.length);
        const items: JsonValue[] = [];
        for (const item of projection.items) {
          items.push(await project(handle, item));
        }
        return items;
      }
    }
  }

  async function locate(
    parent: DeclarativeNodeHandle | undefined,
    locator: DeclarativeReadOperation["scope"]["locator"],
    maximum: number,
  ): Promise<readonly DeclarativeNodeHandle[]> {
    budget.check();
    const result = await adapterCall(budget, () =>
      adapter.locate(
        parent,
        locator,
        { maxMatches: maximum, maxVisits: budget.remainingVisits },
        budget.signal,
      ),
    );
    budget.consumeVisits(result.visited, result.visitLimitExceeded);
    if (result.matchLimitExceeded) {
      throw new DeclarativeRuntimeError("CARDINALITY_EXCEEDED");
    }
    return result.handles;
  }

  async function readText(handle: DeclarativeNodeHandle): Promise<string> {
    budget.check();
    const result = await adapterCall(budget, () =>
      adapter.readText(
        handle,
        budget.limits.maxTextChars,
        budget.remainingVisits,
        budget.signal,
      ),
    );
    budget.consumeVisits(result.visited, false);
    if (result.limitExceeded) {
      throw new DeclarativeRuntimeError("TEXT_LIMIT_EXCEEDED");
    }
    if (result.value === undefined) {
      throw new DeclarativeRuntimeError("PROJECTION_ABSENT");
    }
    return result.value;
  }

  async function readAttribute(
    handle: DeclarativeNodeHandle,
    name: Parameters<DeclarativeDocumentAdapter["readAttribute"]>[1],
  ): Promise<string> {
    budget.check();
    const result = await adapterCall(budget, () =>
      adapter.readAttribute(
        handle,
        name,
        budget.limits.maxAttributeChars,
        budget.signal,
      ),
    );
    if (result.limitExceeded) {
      throw new DeclarativeRuntimeError("ATTRIBUTE_LIMIT_EXCEEDED");
    }
    if (result.value === undefined) {
      throw new DeclarativeRuntimeError("PROJECTION_ABSENT");
    }
    return result.value;
  }

  async function readSource(
    handle: DeclarativeNodeHandle,
    source: DeclarativeScalarSource,
  ): Promise<string> {
    return source.kind === "text"
      ? readText(handle)
      : readAttribute(handle, source.name);
  }

  function chargeScalar<T extends string | number | boolean>(value: T): T {
    budget.consumeScalar(value);
    return value;
  }
}

async function adapterCall<T>(
  budget: DeclarativeExecutionBudget,
  call: () => Promise<T>,
): Promise<T> {
  budget.check();
  try {
    const result = await call();
    budget.check();
    return result;
  } catch (error) {
    if (error instanceof DeclarativeRuntimeError) throw error;
    budget.check();
    throw new DeclarativeRuntimeError("INTERNAL_ERROR");
  }
}

function parseNumber(value: string): number {
  if (!NUMBER.test(value)) invalidPageValue();
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    invalidPageValue();
  }
  return parsed;
}

function parsePercentage(value: string): number {
  if (!PERCENTAGE.test(value)) invalidPageValue();
  const parsed = Number(value.endsWith("%") ? value.slice(0, -1) : value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    invalidPageValue();
  }
  return parsed;
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  invalidPageValue();
}

function invalidPageValue(): never {
  throw new DeclarativeRuntimeError("INVALID_PAGE_VALUE");
}

function validateOutputBounds(
  value: JsonValue,
  budget: DeclarativeExecutionBudget,
): void {
  let nodes = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > budget.limits.maxOutputNodes) outputLimitExceeded();
    if (Array.isArray(current)) {
      stack.push(...current);
    } else if (isDataRecord(current)) {
      stack.push(...Object.values(current));
    }
  }
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    outputLimitExceeded();
  }
  if (bytes > budget.limits.maxOutputBytes) outputLimitExceeded();
}

function outputLimitExceeded(): never {
  throw new DeclarativeRuntimeError("OUTPUT_LIMIT_EXCEEDED");
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeOutput<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) freezeOutput(item);
    Object.freeze(value);
  } else if (isDataRecord(value)) {
    for (const child of Object.values(value)) freezeOutput(child as JsonValue);
    Object.freeze(value);
  }
  return value;
}
