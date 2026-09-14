export type ValidationCode =
  | "INVALID_CAPABILITY"
  | "INVALID_IDENTIFIER"
  | "INVALID_ORIGIN"
  | "INVALID_SCHEMA"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "LIMIT_EXCEEDED"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_VERSION";

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly field: string;
}

export class ProtocolValidationError extends Error {
  readonly issue: ValidationIssue;

  constructor(issue: ValidationIssue) {
    super(`${issue.code} at ${issue.field}`);
    this.name = "ProtocolValidationError";
    this.issue = issue;
  }
}
