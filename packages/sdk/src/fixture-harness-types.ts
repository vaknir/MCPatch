import type {
  PackFixtureErrorCode,
  PackManifestValidationCode,
  PackPermission,
} from "./types.js";

export const PACK_EVIDENCE_VERSION = 1 as const;

/** Untrusted metadata plus reviewed, locally supplied compiled handlers. */
export interface PackFixtureVerificationSubject {
  readonly manifest: unknown;
  readonly handlers: unknown;
}

/** Explicit environment and permission ceiling used during verification. */
export interface PackFixtureVerificationOptions {
  readonly runtimeVersion: string;
  readonly bridgeProtocolVersion: number;
  readonly allowedPermissions: readonly PackPermission[];
  readonly timeoutMs?: number;
}

export type PackVerificationCheckCode =
  | "BRIDGE_PROTOCOL_INCOMPATIBLE"
  | "FIXTURE_EXECUTION_FAILED"
  | "FIXTURE_PREFLIGHT_FAILED"
  | "PERMISSION_EXPANSION"
  | "RUNTIME_INCOMPATIBLE"
  | "SCHEMA_INVALID";

export type PackFixtureVerificationCode =
  | PackFixtureErrorCode
  | "ERROR_CODE_MISMATCH"
  | "EXPECTED_ERROR_MISSING"
  | "FIXTURE_EXPECTATION_INVALID"
  | "FIXTURE_INPUT_INVALID"
  | "PREFLIGHT_FAILED"
  | "RESULT_MISMATCH"
  | "SCHEMA_INVALID"
  | "UNEXPECTED_ERROR";

export type PackVerificationCheck =
  | { readonly status: "passed" }
  | {
      readonly status: "failed";
      readonly code: PackVerificationCheckCode;
    };

interface PackFixtureVerificationIdentity {
  readonly id: string;
  readonly tool: string;
}

export type PackFixtureVerificationEntry =
  | (PackFixtureVerificationIdentity & { readonly status: "passed" })
  | (PackFixtureVerificationIdentity & {
      readonly status: "failed";
      readonly code: PackFixtureVerificationCode;
    })
  | (PackFixtureVerificationIdentity & {
      readonly status: "skipped";
      readonly code: "PREFLIGHT_FAILED";
    });

export interface PackCompatibilityEvidence {
  readonly evidenceVersion: typeof PACK_EVIDENCE_VERSION;
  readonly pack: {
    readonly publisher: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly environment: {
    readonly runtimeVersion: string;
    readonly bridgeProtocolVersion: number;
    readonly allowedPermissions: readonly PackPermission[];
  };
  readonly checks: {
    readonly runtime: PackVerificationCheck;
    readonly bridgeProtocol: PackVerificationCheck;
    readonly permissions: PackVerificationCheck;
    readonly schemas: PackVerificationCheck;
    readonly fixtures: PackVerificationCheck;
  };
  readonly fixtures: readonly PackFixtureVerificationEntry[];
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
  readonly passed: boolean;
}

export type PackVerificationIssue =
  | {
      readonly code:
        "INVALID_HANDLER_TABLE" | "INVALID_OPTIONS" | "INVALID_SUBJECT";
      readonly field: string;
    }
  | {
      readonly code: "INVALID_MANIFEST";
      readonly field: string;
      readonly manifestCode: PackManifestValidationCode;
    };

export type PackVerificationResult =
  | { readonly ok: true; readonly evidence: PackCompatibilityEvidence }
  | { readonly ok: false; readonly issue: PackVerificationIssue };

/** Typed, payload-free error that fixture handlers may intentionally return. */
export class PackToolExecutionError extends Error {
  readonly code: PackFixtureErrorCode;

  constructor(code: PackFixtureErrorCode) {
    super(`Pack tool execution failed: ${code}`);
    this.name = "PackToolExecutionError";
    this.code = code;
  }
}
