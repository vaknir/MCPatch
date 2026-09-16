export const PACK_MANIFEST_VERSION = 1 as const;

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type PackRisk = "action" | "read" | "sensitive";
export type PackPermission =
  | "ACTION"
  | "ARBITRARY_EXECUTION"
  | "CREDENTIAL"
  | "EXTERNAL_NETWORK"
  | "READ"
  | "SENSITIVE";

export interface PackRuntimeCompatibility {
  readonly minimum: string;
  readonly maximumExclusive: string;
}

export interface BridgeProtocolCompatibility {
  readonly minimum: number;
  readonly maximum: number;
}

export interface PackCompatibility {
  readonly runtime: PackRuntimeCompatibility;
  readonly bridgeProtocol: BridgeProtocolCompatibility;
}

export type PackExecution =
  | { readonly kind: "bundled" }
  | { readonly kind: "declarative"; readonly operationsVersion: 1 };

export interface PackPathRule {
  readonly kind: "exact" | "prefix";
  readonly path: string;
}

export interface PackMatch {
  readonly origin: string;
  readonly paths: readonly PackPathRule[];
}

export interface PackNetworkRequestPolicy {
  readonly origins: readonly string[];
  readonly methods: readonly ["GET"];
}

export interface PackNetworkPolicy {
  readonly extensionRequests: "none" | PackNetworkRequestPolicy;
}

export interface PackToolManifest {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly risk: PackRisk;
  readonly permissions: readonly PackPermission[];
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
}

export type PackFixtureExpectation =
  | { readonly kind: "result"; readonly result: JsonValue }
  | { readonly kind: "error"; readonly code: PackFixtureErrorCode };

export type PackFixtureErrorCode =
  | "APPROVAL_DENIED"
  | "APPROVAL_REQUIRED"
  | "CANCELLED"
  | "CAPABILITY_DENIED"
  | "CONTEXT_NOT_FOUND"
  | "EXECUTION_FAILED"
  | "INTERNAL_ERROR"
  | "INVALID_REQUEST"
  | "ORIGIN_MISMATCH"
  | "RESULT_INVALID"
  | "TIMEOUT"
  | "TOOL_NOT_FOUND";

export interface PackFixture {
  readonly id: string;
  readonly tool: string;
  readonly input: JsonObject;
  readonly expect: PackFixtureExpectation;
}

export interface PackManifest {
  readonly manifestVersion: typeof PACK_MANIFEST_VERSION;
  readonly publisher: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly digest: string;
  readonly compatibility: PackCompatibility;
  readonly execution: PackExecution;
  readonly matches: readonly PackMatch[];
  readonly networkPolicy: PackNetworkPolicy;
  readonly tools: readonly PackToolManifest[];
  readonly fixtures: readonly PackFixture[];
}

export type PackManifestValidationCode =
  | "DUPLICATE_VALUE"
  | "INVALID_COMPATIBILITY"
  | "INVALID_DIGEST"
  | "INVALID_IDENTIFIER"
  | "INVALID_ORIGIN"
  | "INVALID_PATH"
  | "INVALID_PERMISSION"
  | "INVALID_REFERENCE"
  | "INVALID_SCHEMA"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "INVALID_VERSION"
  | "LIMIT_EXCEEDED"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_VERSION";

export interface PackManifestValidationIssue {
  readonly code: PackManifestValidationCode;
  readonly field: string;
}
