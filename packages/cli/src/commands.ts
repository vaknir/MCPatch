import { basename } from "node:path";

import { verifyDeclarativeFixtures } from "@mcpatch/sdk/declarative-fixtures";

import { CliError, cliError } from "./errors.js";
import {
  createScaffold,
  loadPackSource,
  resolveTargetDirectory,
  writeArtifact,
} from "./files.js";
import { sourceCommit } from "./git-attribution.js";
import { PACK_SOURCE_FILE } from "./model.js";
import { preparePackSource } from "./source.js";
import { syntheticFixtureRunner } from "./synthetic-runner.js";

export interface CommandContext {
  readonly currentDirectory: string;
}

export async function executeCommand(
  args: readonly string[],
  context: CommandContext,
): Promise<Readonly<Record<string, unknown>>> {
  if (args[0] !== "pack") cliError("USAGE");
  const command = args[1];
  if (command === "create") {
    if (args.length !== 3) cliError("USAGE");
    const target = resolveTargetDirectory(args[2], context.currentDirectory);
    await createScaffold(target, scaffold(target));
    return Object.freeze({
      status: "created",
      source: PACK_SOURCE_FILE,
      target,
    });
  }
  if (
    command !== "validate" &&
    command !== "test" &&
    command !== "inspect" &&
    command !== "build"
  ) {
    cliError("USAGE");
  }
  if (args.length > 3) cliError("USAGE");
  const target = resolveTargetDirectory(args[2], context.currentDirectory);
  const loaded = await loadPackSource(target);

  if (command === "build") {
    const commit = await sourceCommit(target, loaded.sourcePath, loaded.bytes);
    const pack = await preparePackSource(loaded.bytes, {
      sourceCommit: commit,
    });
    const filename = `${pack.manifest.publisher}.${pack.manifest.id}-${pack.manifest.version}.mcpack`;
    const written = await writeArtifact(
      target,
      filename,
      new TextEncoder().encode(pack.buildInput),
    );
    return Object.freeze({
      status: "built",
      artifact: written.path,
      digest: pack.manifest.digest,
      reproducible: true,
      reused: written.reused,
      sourceCommit: commit,
      trust: "UNSIGNED_LOCAL_DEVELOPMENT",
    });
  }

  const pack = await preparePackSource(loaded.bytes);
  if (command === "validate") {
    return Object.freeze({
      status: "valid",
      digest: pack.manifest.digest,
      fixtures: pack.fixtures.length,
      tools: pack.manifest.tools.length,
    });
  }
  if (command === "inspect") {
    return Object.freeze({
      status: "inspected",
      pack: Object.freeze({
        publisher: pack.manifest.publisher,
        id: pack.manifest.id,
        version: pack.manifest.version,
        digest: pack.manifest.digest,
        compatibility: pack.manifest.compatibility,
        matches: pack.manifest.matches,
        networkPolicy: pack.manifest.networkPolicy,
        tools: pack.manifest.tools.map((tool) =>
          Object.freeze({
            name: tool.name,
            ...(tool.title === undefined ? {} : { title: tool.title }),
            description: tool.description,
            risk: tool.risk,
            permissions: tool.permissions,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
          }),
        ),
      }),
    });
  }

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
  return Object.freeze({
    status: "passed",
    fixtures: evidence.fixtures.length,
    tools: pack.manifest.tools.length,
  });
}

function scaffold(targetDirectory: string): Readonly<Record<string, string>> {
  const id = safeIdentifier(basename(targetDirectory));
  const source = {
    sourceVersion: 1,
    publisher: "localdev",
    id,
    name: "Example declarative pack",
    description: "A data-only MCPatch community pack",
    version: "0.1.0",
    compatibility: {
      runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
      bridgeProtocol: { minimum: 2, maximum: 2 },
    },
    matches: [
      {
        origin: "https://example.test",
        paths: [{ kind: "exact", path: "/" }],
      },
    ],
    metadata: { license: "MIT" },
    tools: [
      {
        name: "localdev.page_title",
        description: "Read the current page title",
        risk: "read",
        permissions: ["READ"],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["title"],
          properties: { title: { type: "string" } },
        },
        availability: { kind: "role", role: "heading" },
        scope: {
          kind: "single",
          locator: { kind: "role", role: "heading" },
        },
        projection: {
          kind: "object",
          fields: [{ key: "title", value: { kind: "text" } }],
        },
        fixtures: [
          {
            id: "page-title",
            document: {
              url: "https://example.test/",
              root: { tag: "h1", role: "heading", text: "Example title" },
            },
            result: { title: "Example title" },
          },
        ],
      },
    ],
  };
  const packageJson = {
    name: `mcpatch-${id}`,
    version: "0.1.0",
    private: true,
    scripts: {
      build: "mcpatch pack build .",
      inspect: "mcpatch pack inspect .",
      test: "mcpatch pack test .",
      validate: "mcpatch pack validate .",
    },
  };
  return Object.freeze({
    [PACK_SOURCE_FILE]: `${JSON.stringify(source, null, 2)}\n`,
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "README.md": scaffoldReadme(id),
  });
}

function safeIdentifier(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  return /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/u.test(normalized) &&
    normalized.length >= 3
    ? normalized
    : "example-site";
}

function scaffoldReadme(id: string): string {
  return `# ${id}\n\nThis directory contains one data-only MCPatch pack source. The fixture embedded in \`${PACK_SOURCE_FILE}\` is its deterministic browser-free test.\n\nRun:\n\n- \`mcpatch pack validate .\`\n- \`mcpatch pack test .\`\n- \`mcpatch pack inspect .\`\n- commit \`${PACK_SOURCE_FILE}\`, then run \`mcpatch pack build .\`\n\nBuild refuses untracked or modified source so the emitted unsigned local-development artifact is attributable to an exact Git commit. No command opens a browser, reads a browser profile, or performs network access.\n`;
}
