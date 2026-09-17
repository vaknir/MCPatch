import type {
  DeclarativeLocator,
  DeclarativeSafeAttribute,
} from "@mcpatch/sdk/runtime";

/** Opaque by construction: only a document adapter can resolve a handle. */
declare const declarativeNodeBrand: unique symbol;
export interface DeclarativeNodeHandle {
  readonly [declarativeNodeBrand]: true;
}

export interface DeclarativeLocateLimits {
  readonly maxMatches: number;
  readonly maxVisits: number;
}

export interface DeclarativeLocateResult {
  readonly handles: readonly DeclarativeNodeHandle[];
  readonly visited: number;
  readonly matchLimitExceeded: boolean;
  readonly visitLimitExceeded: boolean;
}

export interface DeclarativeReadResult {
  readonly value?: string;
  readonly visited: number;
  readonly limitExceeded: boolean;
}

/**
 * The interpreter receives no DOM object and no generic property/query method.
 * Implementations must apply the supplied bounds before returning data.
 */
export interface DeclarativeDocumentAdapter {
  locate(
    parent: DeclarativeNodeHandle | undefined,
    locator: DeclarativeLocator,
    limits: DeclarativeLocateLimits,
    signal: AbortSignal,
  ): Promise<DeclarativeLocateResult>;

  readText(
    handle: DeclarativeNodeHandle,
    maxCodePoints: number,
    maxVisits: number,
    signal: AbortSignal,
  ): Promise<DeclarativeReadResult>;

  readAttribute(
    handle: DeclarativeNodeHandle,
    name: DeclarativeSafeAttribute,
    maxCodePoints: number,
    signal: AbortSignal,
  ): Promise<Omit<DeclarativeReadResult, "visited">>;
}

export type DeclarativeRuntimeErrorCode =
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "CAPABILITY_UNAVAILABLE"
  | "CARDINALITY_EXCEEDED"
  | "NODE_VISIT_LIMIT_EXCEEDED"
  | "TEXT_LIMIT_EXCEEDED"
  | "ATTRIBUTE_LIMIT_EXCEEDED"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "PROJECTION_ABSENT"
  | "INVALID_PAGE_VALUE"
  | "RESULT_INVALID"
  | "STALE_CONTEXT"
  | "INTERNAL_ERROR";

export class DeclarativeRuntimeError extends Error {
  readonly code: DeclarativeRuntimeErrorCode;

  constructor(code: DeclarativeRuntimeErrorCode) {
    super(`declarative runtime failed: ${code}`);
    this.name = "DeclarativeRuntimeError";
    this.code = code;
  }
}
