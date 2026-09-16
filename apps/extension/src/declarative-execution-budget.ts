import {
  MAX_ATTRIBUTE_CHARS,
  MAX_NODE_VISITS,
  MAX_OPERATION_DEADLINE_MS,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_NODES,
  MAX_TEXT_CHARS,
} from "@mcpatch/sdk/runtime";

import { DeclarativeRuntimeError } from "./declarative-document-model.js";

export interface DeclarativeRuntimeLimits {
  readonly deadlineMs: number;
  readonly maxAttributeChars: number;
  readonly maxNodeVisits: number;
  readonly maxOutputBytes: number;
  readonly maxOutputNodes: number;
  readonly maxTextChars: number;
}

export const DEFAULT_DECLARATIVE_RUNTIME_LIMITS: DeclarativeRuntimeLimits =
  Object.freeze({
    deadlineMs: MAX_OPERATION_DEADLINE_MS,
    maxAttributeChars: MAX_ATTRIBUTE_CHARS,
    maxNodeVisits: MAX_NODE_VISITS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    maxOutputNodes: MAX_OUTPUT_NODES,
    maxTextChars: MAX_TEXT_CHARS,
  });

export class DeclarativeExecutionBudget {
  readonly limits: DeclarativeRuntimeLimits;
  readonly signal: AbortSignal;
  readonly #assertCurrent: () => void;
  #outputBytes = 0;
  #outputNodes = 0;
  #remainingVisits: number;

  constructor(
    limits: DeclarativeRuntimeLimits,
    signal: AbortSignal,
    assertCurrent: () => void = () => undefined,
  ) {
    this.limits = limits;
    this.signal = signal;
    this.#assertCurrent = assertCurrent;
    this.#remainingVisits = limits.maxNodeVisits;
  }

  get remainingVisits(): number {
    return this.#remainingVisits;
  }

  check(): void {
    if (this.signal.aborted) throw cancellationError(this.signal.reason);
    this.#assertCurrent();
  }

  consumeVisits(count: number, exceeded: boolean): void {
    this.check();
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > this.#remainingVisits ||
      exceeded
    ) {
      throw new DeclarativeRuntimeError("NODE_VISIT_LIMIT_EXCEEDED");
    }
    this.#remainingVisits -= count;
  }

  consumeArrayContainer(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0) this.#outputExceeded();
    this.#consumeOutput(1, 2 + Math.max(0, length - 1));
  }

  consumeObjectContainer(keys: readonly string[]): void {
    let bytes = 2 + Math.max(0, keys.length - 1);
    for (const key of keys) bytes += encodedJsonBytes(key) + 1;
    this.#consumeOutput(1, bytes);
  }

  consumeScalar(value: string | number | boolean | null): void {
    this.#consumeOutput(1, encodedJsonBytes(value));
  }

  consumeConstant(value: unknown): void {
    const stack: unknown[] = [value];
    while (stack.length > 0) {
      const current = stack.pop();
      if (Array.isArray(current)) {
        this.consumeArrayContainer(current.length);
        stack.push(...current);
      } else if (isRecord(current)) {
        const keys = Object.keys(current);
        this.consumeObjectContainer(keys);
        stack.push(...Object.values(current));
      } else if (
        current === null ||
        typeof current === "string" ||
        typeof current === "boolean" ||
        (typeof current === "number" && Number.isFinite(current))
      ) {
        this.consumeScalar(current);
      } else {
        this.#outputExceeded();
      }
    }
  }

  #consumeOutput(nodes: number, bytes: number): void {
    this.check();
    this.#outputNodes += nodes;
    this.#outputBytes += bytes;
    if (
      this.#outputNodes > this.limits.maxOutputNodes ||
      this.#outputBytes > this.limits.maxOutputBytes
    ) {
      this.#outputExceeded();
    }
  }

  #outputExceeded(): never {
    throw new DeclarativeRuntimeError("OUTPUT_LIMIT_EXCEEDED");
  }
}

export async function withExecutionDeadline<T>(
  outerSignal: AbortSignal,
  deadlineMs: number,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > MAX_OPERATION_DEADLINE_MS
  ) {
    throw new TypeError("declarative deadline is invalid");
  }
  if (outerSignal.aborted) throw cancellationError(outerSignal.reason);

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    const abort = () => {
      controller.abort(outerSignal.reason);
      reject(cancellationError(outerSignal.reason));
    };
    outerSignal.addEventListener("abort", abort, { once: true });
    removeAbort = () => outerSignal.removeEventListener("abort", abort);
  });
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new DeclarativeRuntimeError("DEADLINE_EXCEEDED");
      controller.abort(error);
      reject(error);
    }, deadlineMs);
  });

  try {
    return await Promise.race([execute(controller.signal), cancelled, expired]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    removeAbort?.();
    controller.abort();
  }
}

function cancellationError(reason: unknown): DeclarativeRuntimeError {
  return reason instanceof DeclarativeRuntimeError
    ? reason
    : new DeclarativeRuntimeError("CANCELLED");
}

function encodedJsonBytes(value: string | number | boolean | null): number {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new DeclarativeRuntimeError("OUTPUT_LIMIT_EXCEEDED");
  }
  return new TextEncoder().encode(encoded).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
