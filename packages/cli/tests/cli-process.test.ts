import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("community pack CLI process", () => {
  it("creates, validates, tests, and inspects a browser-free pack", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "weather-reader");

    expect(run(["pack", "create", target])).toMatchObject({
      status: 0,
      stdout: { status: "created", source: "mcpatch.pack.json" },
    });
    expect(run(["pack", "validate", target])).toMatchObject({
      status: 0,
      stdout: { status: "valid", fixtures: 1, tools: 1 },
    });
    expect(run(["pack", "test", target])).toMatchObject({
      status: 0,
      stdout: { status: "passed", fixtures: 1, tools: 1 },
    });
    const inspected = run(["pack", "inspect", target]);
    expect(inspected).toMatchObject({
      status: 0,
      stdout: {
        status: "inspected",
        pack: {
          publisher: "localdev",
          id: "weather-reader",
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
          networkPolicy: { extensionRequests: "none" },
          tools: [
            {
              name: "localdev.page_title",
              risk: "read",
              permissions: ["READ"],
            },
          ],
        },
      },
    });
  });

  it("reports malformed and incompatible sources without echoing payloads", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "malformed-pack");
    run(["pack", "create", target]);
    const sourcePath = join(target, "mcpatch.pack.json");
    const marker = "private-fixture-marker";
    await writeFile(
      sourcePath,
      `{"sourceVersion":1,"sourceVersion":1,"secret":"${marker}"}`,
    );
    const malformed = run(["pack", "validate", target]);
    expect(malformed).toMatchObject({
      status: 1,
      stderr: { status: "error", code: "DUPLICATE_KEY", field: "$" },
    });
    expect(malformed.rawStderr).not.toContain(marker);

    await writeFile(
      sourcePath,
      Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x7d]),
    );
    expect(run(["pack", "validate", target])).toMatchObject({
      status: 1,
      stderr: { status: "error", code: "INVALID_JSON", field: "$" },
    });

    await writeFile(sourcePath, `${JSON.stringify({ sourceVersion: 2 })}\n`);
    expect(run(["pack", "validate", target])).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "SOURCE_INVALID",
        field: "$source.publisher",
      },
    });

    const scaffold = await createPack(join(root, "version-pack"));
    const source = JSON.parse(
      await readFile(join(scaffold, "mcpatch.pack.json"), "utf8"),
    ) as Record<string, unknown>;
    source.sourceVersion = 2;
    await writeFile(
      join(scaffold, "mcpatch.pack.json"),
      `${JSON.stringify(source)}\n`,
    );
    expect(run(["pack", "validate", scaffold])).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "INCOMPATIBLE_SOURCE_VERSION",
        field: "$source.sourceVersion",
      },
    });

    const incompatible = await createPack(join(root, "incompatible-pack"));
    const incompatiblePath = join(incompatible, "mcpatch.pack.json");
    const incompatibleSource = JSON.parse(
      await readFile(incompatiblePath, "utf8"),
    ) as {
      compatibility: {
        runtime: { minimum: string; maximumExclusive: string };
      };
    };
    incompatibleSource.compatibility.runtime = {
      minimum: "9.0.0",
      maximumExclusive: "10.0.0",
    };
    await writeFile(
      incompatiblePath,
      `${JSON.stringify(incompatibleSource)}\n`,
    );
    expect(run(["pack", "validate", incompatible])).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "PACK_INCOMPATIBLE",
        field: "$source.compatibility.runtime",
      },
    });
  });

  it("builds deterministic attributable bytes and refuses dirty source", async () => {
    const root = await temporaryDirectory();
    const target = await createPack(join(root, "stock-reader"));
    commitPack(target);

    const first = run(["pack", "build", target]);
    expect(first).toMatchObject({
      status: 0,
      stdout: {
        status: "built",
        reproducible: true,
        reused: false,
        trust: "UNSIGNED_LOCAL_DEVELOPMENT",
      },
    });
    const artifact = (first.stdout as { artifact: string }).artifact;
    const firstBytes = await readFile(artifact);
    const built = JSON.parse(firstBytes.toString("utf8")) as {
      metadata: { sourceCommit?: string };
      publisherSignature?: unknown;
    };
    expect(built.metadata.sourceCommit).toMatch(/^[a-f0-9]{40,64}$/u);
    expect(built).not.toHaveProperty("publisherSignature");
    expect(await readdir(join(target, "dist"))).toEqual([
      "localdev.stock-reader-0.1.0.mcpack",
    ]);
    const second = run(["pack", "build", target]);
    expect(second).toMatchObject({
      status: 0,
      stdout: { status: "built", reused: true },
    });
    expect(await readFile(artifact)).toEqual(firstBytes);

    await writeFile(
      join(target, "mcpatch.pack.json"),
      `${await readFile(join(target, "mcpatch.pack.json"), "utf8")} `,
    );
    expect(run(["pack", "build", target])).toMatchObject({
      status: 1,
      stderr: { status: "error", code: "SOURCE_UNATTRIBUTED" },
    });
  });

  it("rejects unsafe source nodes and interrupted output staging", async () => {
    const root = await temporaryDirectory();
    const unsafe = await createPack(join(root, "unsafe-pack"));
    const sourcePath = join(unsafe, "mcpatch.pack.json");
    await rename(sourcePath, join(unsafe, "saved-source.json"));
    await mkdir(sourcePath);
    expect(run(["pack", "validate", unsafe])).toMatchObject({
      status: 1,
      stderr: { status: "error", code: "UNSAFE_PATH", field: "$source" },
    });

    const interrupted = await createPack(join(root, "interrupted-pack"));
    commitPack(interrupted);
    const outputDirectory = join(interrupted, "dist");
    await mkdir(outputDirectory);
    const staging = join(
      outputDirectory,
      ".localdev.interrupted-pack-0.1.0.mcpack.tmp",
    );
    await writeFile(staging, "partial-private-payload");
    const result = run(["pack", "build", interrupted]);
    expect(result).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "WRITE_INTERRUPTED",
        field: "dist",
      },
    });
    expect(result.rawStderr).not.toContain("partial-private-payload");
  });

  it("fails a fixture mismatch with only stable identifiers", async () => {
    const root = await temporaryDirectory();
    const target = await createPack(join(root, "mismatch-pack"));
    const sourcePath = join(target, "mcpatch.pack.json");
    const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
      tools: Array<{
        fixtures: Array<{ result: { title: string } }>;
      }>;
    };
    const fixture = source.tools[0]?.fixtures[0];
    if (fixture === undefined) throw new Error("fixture missing");
    fixture.result.title = "private-expected-value";
    await writeFile(sourcePath, `${JSON.stringify(source)}\n`);

    const result = run(["pack", "test", target]);
    expect(result).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "TEST_FAILED",
        field: "page-title",
      },
    });
    expect(result.rawStderr).not.toContain("private-expected-value");
    expect(result.rawStderr).not.toContain("Example title");
  });
});

async function createPack(target: string): Promise<string> {
  const result = run(["pack", "create", target]);
  if (result.status !== 0) throw new Error("pack creation failed");
  return target;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcpatch-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function commitPack(target: string): void {
  git(target, ["init", "-q"]);
  git(target, ["config", "user.name", "MCPatch Test"]);
  git(target, ["config", "user.email", "mcpatch@example.invalid"]);
  git(target, ["add", "mcpatch.pack.json", "README.md", "package.json"]);
  git(target, ["commit", "-qm", "test: add pack"]);
}

function git(directory: string, args: readonly string[]): void {
  execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

function run(args: readonly string[]): {
  readonly rawStderr: string;
  readonly rawStdout: string;
  readonly status: number | null;
  readonly stderr?: unknown;
  readonly stdout?: unknown;
} {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dirname(CLI),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 10_000,
  });
  const rawStdout = result.stdout.trim();
  const rawStderr = result.stderr.trim();
  return {
    rawStderr,
    rawStdout,
    status: result.status,
    ...(rawStderr === "" ? {} : { stderr: JSON.parse(rawStderr) as unknown }),
    ...(rawStdout === "" ? {} : { stdout: JSON.parse(rawStdout) as unknown }),
  };
}
