import type { ValidateFunction } from "ajv";

import type { PackToolHandler } from "./authoring.js";
import {
  PackToolExecutionError,
  type PackFixtureVerificationCode,
} from "./fixture-harness-types.js";
import type { JsonValue, PackFixture } from "./types.js";
import { structuredResult } from "./tool-result.js";
import { isRecord, validateJsonBounds } from "./validation/primitives.js";

interface ExecutionValidators {
  readonly output: ValidateFunction;
}

type ExecutionOutcome =
  | { readonly kind: "result"; readonly value: unknown }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "timeout" };

export async function executeFixture(
  fixture: PackFixture,
  handler: PackToolHandler,
  validators: ExecutionValidators,
  origin: string,
  timeoutMs: number,
): Promise<PackFixtureVerificationCode | undefined> {
  const outcome = await invokeHandler(fixture, handler, origin, timeoutMs);
  if (fixture.expect.kind === "error") {
    if (outcome.kind === "timeout") {
      return fixture.expect.code === "TIMEOUT"
        ? undefined
        : "ERROR_CODE_MISMATCH";
    }
    if (outcome.kind === "error") {
      if (!(outcome.error instanceof PackToolExecutionError)) {
        return "UNEXPECTED_ERROR";
      }
      return outcome.error.code === fixture.expect.code
        ? undefined
        : "ERROR_CODE_MISMATCH";
    }
    if (!validResult(outcome.value, validators.output)) {
      return "RESULT_INVALID";
    }
    return "EXPECTED_ERROR_MISSING";
  }

  if (outcome.kind === "timeout") return "TIMEOUT";
  if (outcome.kind === "error") return "UNEXPECTED_ERROR";
  if (!validResult(outcome.value, validators.output)) return "RESULT_INVALID";
  return jsonEqual(outcome.value as JsonValue, fixture.expect.result)
    ? undefined
    : "RESULT_MISMATCH";
}

async function invokeHandler(
  fixture: PackFixture,
  handler: PackToolHandler,
  origin: string,
  timeoutMs: number,
): Promise<ExecutionOutcome> {
  const controller = new AbortController();
  const context = Object.freeze({
    contextId: `fixture:${fixture.id}`,
    origin,
    signal: controller.signal,
  });
  const execution = Promise.resolve()
    .then(() => handler(context, fixture.input))
    .then<ExecutionOutcome, ExecutionOutcome>(
      (value) => ({ kind: "result", value: structuredResult(value) }),
      (error: unknown) => ({ kind: "error", error }),
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ExecutionOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });
  const outcome = await Promise.race([execution, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return outcome;
}

function validResult(value: unknown, validator: ValidateFunction): boolean {
  return validateJsonBounds(value) === undefined && validator(value);
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
