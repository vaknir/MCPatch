import type { PackToolHandler } from "./authoring.js";
import { executeFixture } from "./fixture-harness-execution.js";
import {
  PACK_EVIDENCE_VERSION,
  type PackCompatibilityEvidence,
  type PackFixtureVerificationEntry,
  type PackFixtureVerificationOptions,
  type PackFixtureVerificationSubject,
  type PackVerificationCheck,
  type PackVerificationCheckCode,
  type PackVerificationResult,
} from "./fixture-harness-types.js";
import {
  validateOptions,
  validateSubject,
  type ValidatedVerificationOptions,
} from "./fixture-harness-input.js";
import {
  bridgeProtocolIsCompatible,
  compileToolSchemas,
  permissionsAreAllowed,
  runtimeIsCompatible,
  type ToolSchemaValidators,
} from "./fixture-harness-validation.js";
import type { PackFixture, PackManifest } from "./types.js";
import { cloneAndFreeze } from "./validation/primitives.js";

const PASSED = Object.freeze({ status: "passed" as const });

/** Verifies a locally supplied compiled pack without supplying browser authority. */
export async function verifyPackFixtures(
  subject: PackFixtureVerificationSubject,
  options: PackFixtureVerificationOptions,
): Promise<PackVerificationResult> {
  const checkedSubject = validateSubject(subject);
  if ("issue" in checkedSubject)
    return frozen({ ok: false, issue: checkedSubject.issue });
  const checkedOptions = validateOptions(options);
  if ("issue" in checkedOptions)
    return frozen({ ok: false, issue: checkedOptions.issue });

  const { manifest, handlers } = checkedSubject;
  const schemaResult = compileToolSchemas(manifest.tools);
  const checks = initialChecks(
    manifest,
    checkedOptions,
    schemaResult.invalidTools.size,
  );
  const fixturePreflight = preflightFixtures(manifest.fixtures, schemaResult);
  if (fixturePreflight.some((entry) => entry !== undefined)) {
    checks.fixtures = failed("FIXTURE_PREFLIGHT_FAILED");
  }

  if (Object.values(checks).some((check) => check.status === "failed")) {
    const fixtures = manifest.fixtures.map(
      (fixture, index) => fixturePreflight[index] ?? skipped(fixture),
    );
    return successfulResult(manifest, checkedOptions, checks, fixtures);
  }

  const fixtures: PackFixtureVerificationEntry[] = [];
  const origin = manifest.matches[0]?.origin ?? "https://invalid.invalid";
  for (const fixture of manifest.fixtures) {
    const handler = handlers[fixture.tool] as PackToolHandler;
    const validators = schemaResult.validators.get(
      fixture.tool,
    ) as ToolSchemaValidators;
    const code = await executeFixture(
      fixture,
      handler,
      validators,
      origin,
      checkedOptions.timeoutMs,
    );
    fixtures.push(
      code === undefined
        ? { id: fixture.id, tool: fixture.tool, status: "passed" }
        : { id: fixture.id, tool: fixture.tool, status: "failed", code },
    );
  }
  if (fixtures.some((fixture) => fixture.status === "failed")) {
    checks.fixtures = failed("FIXTURE_EXECUTION_FAILED");
  }
  return successfulResult(manifest, checkedOptions, checks, fixtures);
}

function initialChecks(
  manifest: PackManifest,
  options: ValidatedVerificationOptions,
  invalidSchemaCount: number,
): MutableChecks {
  return {
    runtime: runtimeIsCompatible(manifest, options.runtimeVersion)
      ? PASSED
      : failed("RUNTIME_INCOMPATIBLE"),
    bridgeProtocol: bridgeProtocolIsCompatible(
      manifest,
      options.bridgeProtocolVersion,
    )
      ? PASSED
      : failed("BRIDGE_PROTOCOL_INCOMPATIBLE"),
    permissions: permissionsAreAllowed(manifest, options.allowedPermissions)
      ? PASSED
      : failed("PERMISSION_EXPANSION"),
    schemas: invalidSchemaCount === 0 ? PASSED : failed("SCHEMA_INVALID"),
    fixtures: PASSED,
  };
}

function preflightFixtures(
  fixtures: readonly PackFixture[],
  schemaResult: ReturnType<typeof compileToolSchemas>,
): Array<PackFixtureVerificationEntry | undefined> {
  return fixtures.map((fixture) => {
    if (schemaResult.invalidTools.has(fixture.tool)) {
      return failedFixture(fixture, "SCHEMA_INVALID");
    }
    const validators = schemaResult.validators.get(fixture.tool);
    if (validators === undefined || !validators.input(fixture.input)) {
      return failedFixture(fixture, "FIXTURE_INPUT_INVALID");
    }
    if (
      fixture.expect.kind === "result" &&
      !validators.output(fixture.expect.result)
    ) {
      return failedFixture(fixture, "FIXTURE_EXPECTATION_INVALID");
    }
    return undefined;
  });
}

function successfulResult(
  manifest: PackManifest,
  options: ValidatedVerificationOptions,
  checks: MutableChecks,
  fixtures: readonly PackFixtureVerificationEntry[],
): PackVerificationResult {
  const summary = {
    total: fixtures.length,
    passed: fixtures.filter((fixture) => fixture.status === "passed").length,
    failed: fixtures.filter((fixture) => fixture.status === "failed").length,
    skipped: fixtures.filter((fixture) => fixture.status === "skipped").length,
  };
  const evidence: PackCompatibilityEvidence = {
    evidenceVersion: PACK_EVIDENCE_VERSION,
    pack: {
      publisher: manifest.publisher,
      id: manifest.id,
      version: manifest.version,
      digest: manifest.digest,
    },
    environment: {
      runtimeVersion: options.runtimeVersion,
      bridgeProtocolVersion: options.bridgeProtocolVersion,
      allowedPermissions: options.allowedPermissions,
    },
    checks,
    fixtures,
    summary,
    passed: Object.values(checks).every((check) => check.status === "passed"),
  };
  return frozen({ ok: true, evidence });
}

function failed<TCode extends PackVerificationCheckCode>(
  code: TCode,
): { readonly status: "failed"; readonly code: TCode } {
  return { status: "failed", code };
}

function failedFixture(
  fixture: PackFixture,
  code:
    "FIXTURE_EXPECTATION_INVALID" | "FIXTURE_INPUT_INVALID" | "SCHEMA_INVALID",
): PackFixtureVerificationEntry {
  return { id: fixture.id, tool: fixture.tool, status: "failed", code };
}

function skipped(fixture: PackFixture): PackFixtureVerificationEntry {
  return {
    id: fixture.id,
    tool: fixture.tool,
    status: "skipped",
    code: "PREFLIGHT_FAILED",
  };
}

function frozen<T>(value: T): T {
  return cloneAndFreeze(value) as T;
}

interface MutableChecks {
  runtime: PackVerificationCheck;
  bridgeProtocol: PackVerificationCheck;
  permissions: PackVerificationCheck;
  schemas: PackVerificationCheck;
  fixtures: PackVerificationCheck;
}
