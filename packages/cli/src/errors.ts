import {
  DeclarativePackBundleValidationError,
  PackManifestValidationError,
} from "@mcpatch/sdk";

export type CliErrorCode =
  | "INCOMPATIBLE_SOURCE_VERSION"
  | "INTERNAL_ERROR"
  | "OUTPUT_DIRTY"
  | "PACK_INCOMPATIBLE"
  | "PUBLICATION_REPRODUCTION_FAILED"
  | "REVIEW_REPORT_INVALID"
  | "REGISTRY_SOURCE_INVALID"
  | "SIGNING_KEY_MISSING"
  | "SIGNING_KEY_INVALID"
  | "SOURCE_INVALID"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_UNATTRIBUTED"
  | "TARGET_EXISTS"
  | "TEST_FAILED"
  | "UNSAFE_PATH"
  | "USAGE"
  | "WRITE_INTERRUPTED";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly field?: string;

  constructor(code: CliErrorCode, field?: string) {
    super(`MCPatch pack command failed: ${code}`);
    this.name = "CliError";
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

export interface ErrorReport {
  readonly status: "error";
  readonly code: string;
  readonly field?: string;
}

export function errorReport(error: unknown): ErrorReport {
  if (
    error instanceof DeclarativePackBundleValidationError ||
    error instanceof PackManifestValidationError
  ) {
    return Object.freeze({
      status: "error",
      code: error.issue.code,
      field: error.issue.field,
    });
  }
  if (error instanceof CliError) {
    return Object.freeze({
      status: "error",
      code: error.code,
      ...(error.field === undefined ? {} : { field: error.field }),
    });
  }
  return Object.freeze({ status: "error", code: "INTERNAL_ERROR" });
}

export function cliError(code: CliErrorCode, field?: string): never {
  throw new CliError(code, field);
}
