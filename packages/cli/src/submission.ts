import { createHash } from "node:crypto";
import { join } from "node:path";

import { verifyDeclarativeFixtures } from "@mcpatch/sdk/declarative-fixtures";
import type { DeclarativePackBuild } from "@mcpatch/sdk/declarative";

import { CliError } from "./errors.js";
import { publishStaticTree } from "./files.js";
import { syntheticFixtureRunner } from "./synthetic-runner.js";

export const SUBMISSION_OUTPUT_DIRECTORY = "submission-dist";
export const SUBMISSION_REVIEW_VERSION = 1 as const;
const UTF8 = new TextEncoder();

export interface SubmissionReviewReport {
  readonly reviewReportVersion: typeof SUBMISSION_REVIEW_VERSION;
  readonly sourceCommit: string;
  readonly artifact: Readonly<{
    readonly publisher: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
    readonly bundleVersion: number;
    readonly operationsVersion: number;
  }>;
  readonly authorityDigest: string;
  readonly authority: Readonly<{
    readonly compatibility: DeclarativePackBuild["manifest"]["compatibility"];
    readonly matches: DeclarativePackBuild["manifest"]["matches"];
    readonly networkPolicy: DeclarativePackBuild["manifest"]["networkPolicy"];
    readonly tools: readonly Readonly<{
      readonly name: string;
      readonly title?: string;
      readonly description: string;
      readonly risk: string;
      readonly permissions: readonly string[];
      readonly inputSchema: object;
      readonly outputSchema: object;
      readonly operation: DeclarativePackBuild["program"]["operations"][number];
    }>[];
  }>;
  readonly fixtures: Readonly<{
    readonly passed: number;
    readonly total: number;
    readonly cases: readonly Readonly<{
      readonly id: string;
      readonly tool: string;
      readonly status: "passed";
    }>[];
  }>;
}

export async function prepareSubmission(
  targetDirectory: string,
  pack: DeclarativePackBuild,
  sourceCommit: string,
): Promise<Readonly<Record<string, unknown>>> {
  const report = await createSubmissionReview(pack, sourceCommit);
  const baseName = `${pack.manifest.publisher}.${pack.manifest.id}-${pack.manifest.version}`;
  const artifactName = `${baseName}.mcpack`;
  const reviewName = `${baseName}.review.json`;
  const files = new Map<string, Uint8Array>([
    [artifactName, UTF8.encode(pack.buildInput)],
    [reviewName, UTF8.encode(`${JSON.stringify(report, null, 2)}\n`)],
  ]);
  const output = await publishStaticTree(
    targetDirectory,
    SUBMISSION_OUTPUT_DIRECTORY,
    files,
  );
  return Object.freeze({
    status: "submitted",
    artifact: join(output.path, artifactName),
    review: join(output.path, reviewName),
    digest: pack.manifest.digest,
    sourceCommit,
    fixtures: report.fixtures.total,
    reproducible: true,
    reused: output.reused,
    signed: false,
  });
}

export async function createSubmissionReview(
  pack: DeclarativePackBuild,
  sourceCommit: string,
): Promise<SubmissionReviewReport> {
  const evidence = await verifyDeclarativeFixtures(
    pack,
    syntheticFixtureRunner,
  );
  if (!evidence.passed) {
    const firstFailure = evidence.fixtures.find(
      (fixture) => fixture.status === "failed",
    );
    throw new CliError("TEST_FAILED", firstFailure?.id ?? "fixtures");
  }
  const operations = new Map(
    pack.program.operations.map((operation) => [operation.tool, operation]),
  );
  const authority = {
    compatibility: pack.manifest.compatibility,
    matches: pack.manifest.matches,
    networkPolicy: pack.manifest.networkPolicy,
    tools: pack.manifest.tools.map((tool) => {
      const operation = operations.get(tool.name);
      if (operation === undefined) throw new CliError("INTERNAL_ERROR");
      return {
        name: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        description: tool.description,
        risk: tool.risk,
        permissions: tool.permissions,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        operation,
      };
    }),
  } as const;
  const authorityDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(authority), "utf8")
    .digest("hex")}`;
  return Object.freeze({
    reviewReportVersion: SUBMISSION_REVIEW_VERSION,
    sourceCommit,
    artifact: Object.freeze({
      publisher: pack.manifest.publisher,
      id: pack.manifest.id,
      version: pack.manifest.version,
      digest: pack.manifest.digest,
      bundleVersion: pack.bundleContent.bundleVersion,
      operationsVersion: pack.bundleContent.operations.operationsVersion,
    }),
    authorityDigest,
    authority,
    fixtures: Object.freeze({
      passed: evidence.fixtures.length,
      total: evidence.fixtures.length,
      cases: evidence.fixtures.map((fixture) =>
        Object.freeze({
          id: fixture.id,
          tool: fixture.tool,
          status: "passed" as const,
        }),
      ),
    }),
  });
}
