import type { JsonValue } from "./types.js";
import type {
  BuiltDeclarativeFixture,
  DeclarativePackBuild,
} from "./declarative-authoring.js";
import type { DeclarativeOperation } from "./declarative-operations-types.js";
import type { SyntheticDocument } from "./declarative-synthetic-document.js";
import { compileToolSchemas } from "./fixture-harness-validation.js";
import {
  cloneAndFreeze,
  isRecord,
  validateJsonBounds,
} from "./validation/primitives.js";

export interface DeclarativeFixtureRunRequest {
  readonly operation: DeclarativeOperation;
  readonly document: SyntheticDocument;
}

/** Implemented by the bounded interpreter; the harness owns all comparison logic. */
export interface DeclarativeFixtureRunner {
  run(request: DeclarativeFixtureRunRequest): JsonValue | Promise<JsonValue>;
}

export type DeclarativeFixtureEvidence = Readonly<{
  readonly passed: boolean;
  readonly fixtures: readonly Readonly<{
    readonly id: string;
    readonly tool: string;
    readonly status: "passed" | "failed";
    readonly code?: "EXECUTION_FAILED" | "RESULT_INVALID" | "RESULT_MISMATCH";
  }>[];
}>;

export async function verifyDeclarativeFixtures(
  pack: DeclarativePackBuild,
  runner: DeclarativeFixtureRunner,
): Promise<DeclarativeFixtureEvidence> {
  const operations = new Map(
    pack.program.operations.map((operation) => [operation.tool, operation]),
  );
  const validators = compileToolSchemas(pack.manifest.tools).validators;
  const evidence = [];
  for (const fixture of pack.fixtures) {
    evidence.push(await runFixture(fixture, operations, validators, runner));
  }
  return cloneAndFreeze({
    passed: evidence.every((entry) => entry.status === "passed"),
    fixtures: evidence,
  }) as DeclarativeFixtureEvidence;
}

async function runFixture(
  fixture: BuiltDeclarativeFixture,
  operations: ReadonlyMap<string, DeclarativeOperation>,
  validators: ReturnType<typeof compileToolSchemas>["validators"],
  runner: DeclarativeFixtureRunner,
) {
  const identity = { id: fixture.id, tool: fixture.tool };
  const operation = operations.get(fixture.tool);
  const validator = validators.get(fixture.tool);
  if (operation === undefined || validator === undefined) {
    return {
      ...identity,
      status: "failed" as const,
      code: "RESULT_INVALID" as const,
    };
  }
  let result: JsonValue;
  try {
    result = await runner.run(
      cloneAndFreeze({
        operation,
        document: fixture.document,
      }) as DeclarativeFixtureRunRequest,
    );
  } catch {
    return {
      ...identity,
      status: "failed" as const,
      code: "EXECUTION_FAILED" as const,
    };
  }
  if (validateJsonBounds(result) !== undefined || !validator.output(result)) {
    return {
      ...identity,
      status: "failed" as const,
      code: "RESULT_INVALID" as const,
    };
  }
  return jsonEqual(result, fixture.result)
    ? { ...identity, status: "passed" as const }
    : {
        ...identity,
        status: "failed" as const,
        code: "RESULT_MISMATCH" as const,
      };
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index] as JsonValue))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        jsonEqual(left[key] as JsonValue, right[key] as JsonValue),
    )
  );
}
