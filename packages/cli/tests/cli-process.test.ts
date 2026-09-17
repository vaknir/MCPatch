import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";
import {
  parseDeclarativePackBundleContentBytes,
  serializeDeclarativePackBundle,
  signDeclarativePackBundle,
  verifyCommunityRegistryIndex,
} from "@mcpatch/sdk";

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

  it("prepares an unsigned reproducible submission and payload-free review report", async () => {
    const root = await temporaryDirectory();
    const target = await createPack(join(root, "submission-reader"));
    commitPack(target);

    const first = run(["pack", "submit", target]);
    expect(first).toMatchObject({
      status: 0,
      stdout: {
        status: "submitted",
        fixtures: 1,
        reproducible: true,
        reused: false,
        signed: false,
      },
    });
    const result = first.stdout as { artifact: string; review: string };
    const artifact = JSON.parse(await readFile(result.artifact, "utf8")) as {
      manifest: { digest: string };
      publisherSignature?: unknown;
    };
    expect(artifact).not.toHaveProperty("publisherSignature");
    const reviewText = await readFile(result.review, "utf8");
    const review = JSON.parse(reviewText) as {
      authorityDigest: string;
      artifact: { digest: string };
      authority: { tools: Array<{ operation: { kind: string } }> };
      fixtures: { passed: number; total: number };
    };
    expect(review).toMatchObject({
      reviewReportVersion: 1,
      artifact: { digest: artifact.manifest.digest },
      authority: { tools: [{ operation: { kind: "read" } }] },
      fixtures: { passed: 1, total: 1 },
    });
    expect(review.authorityDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(reviewText).not.toContain("Example title");
    expect(run(["pack", "submit", target])).toMatchObject({
      status: 0,
      stdout: { reused: true },
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

  it("publishes a reproducible signed static registry without copying signing keys", async () => {
    const root = await temporaryDirectory();
    const fixture = await createRegistryFixture(root);

    const first = run(
      ["registry", "build", fixture.registry],
      registryEnvironment(),
    );
    expect(first).toMatchObject({
      status: 0,
      stdout: {
        status: "built",
        packs: 1,
        publicationSequence: 7,
        registryId: "mcpatch-registry",
        reproducible: true,
        reused: false,
      },
    });
    const output = (first.stdout as { artifact: string }).artifact;
    const indexBytes = await readFile(join(output, "v1", "index.json"));
    const verified = await verifyCommunityRegistryIndex(indexBytes, {
      expectedRegistryId: "mcpatch-registry",
      publicKey: encode(registryKeys().publicKey),
      now: new Date("2026-09-17T00:00:00.000Z"),
    });
    expect(verified).toMatchObject({
      ok: true,
      index: {
        publicationSequence: 7,
        packs: [
          {
            publisher: "localdev",
            id: "registry-reader",
            trust: "REVIEWED_COMMUNITY",
          },
        ],
      },
    });
    if (!verified.ok) throw new Error("registry verification failed");
    const entry = verified.index.packs[0];
    if (entry === undefined) throw new Error("registry entry missing");
    expect(
      await readFile(join(output, ...entry.bundlePath.slice(1).split("/"))),
    ).toEqual(fixture.signedBundle);
    expect(await readFile(join(output, "_headers"), "utf8")).toContain(
      "application/vnd.mcpatch.pack+json",
    );
    expect(await readdir(output)).toEqual(["_headers", "v1"]);
    expect(
      Buffer.concat(
        await Promise.all([
          readFile(join(output, "_headers")),
          readFile(join(output, "v1", "index.json")),
        ]),
      ).toString("utf8"),
    ).not.toContain(registryEnvironment().MCPATCH_REGISTRY_PRIVATE_KEY);

    expect(
      run(["registry", "build", fixture.registry], registryEnvironment()),
    ).toMatchObject({ status: 0, stdout: { reused: true } });
  });

  it("fails closed for registry substitution, unsafe paths, missing keys, and dirty output", async () => {
    const root = await temporaryDirectory();
    const substituted = await createRegistryFixture(join(root, "substituted"));
    const bytes = Buffer.from(substituted.signedBundle);
    const substitutedOffset = bytes.length - 2;
    bytes[substitutedOffset] = (bytes[substitutedOffset] ?? 0) ^ 1;
    await writeFile(substituted.bundlePath, bytes);
    expect(
      run(["registry", "build", substituted.registry], registryEnvironment()),
    ).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "REGISTRY_SOURCE_INVALID",
        field: "registry.packs.bundle",
      },
    });

    const missingKey = await createRegistryFixture(join(root, "missing-key"));
    expect(run(["registry", "build", missingKey.registry])).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "SIGNING_KEY_MISSING",
        field: "registry.signingKey",
      },
    });

    const unsafe = await createRegistryFixture(join(root, "unsafe"));
    await rm(unsafe.bundlePath);
    await symlink("../mcpatch.registry.json", unsafe.bundlePath);
    expect(
      run(["registry", "build", unsafe.registry], registryEnvironment()),
    ).toMatchObject({
      status: 1,
      stderr: { status: "error", code: "UNSAFE_PATH" },
    });

    const dirty = await createRegistryFixture(join(root, "dirty"));
    const built = run(
      ["registry", "build", dirty.registry],
      registryEnvironment(),
    );
    if (built.status !== 0) throw new Error("registry fixture build failed");
    const output = (built.stdout as { artifact: string }).artifact;
    await writeFile(join(output, "_headers"), "substituted-output");
    expect(
      run(["registry", "build", dirty.registry], registryEnvironment()),
    ).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "OUTPUT_DIRTY",
        field: "registry-dist",
      },
    });
  });

  it("reproduces reviewed source before maintainer-only registry publication", async () => {
    const root = await temporaryDirectory();
    const fixture = await createPublicationFixture(root);

    const first = run(["registry", "publish", root], registryEnvironment());
    expect(first).toMatchObject({
      status: 0,
      stdout: {
        status: "published",
        bundleDigests: [
          "sha256:b54588584676e1d95a76f955a9efe08f2f67589ea45e273a96ec33bc6be5b29d",
        ],
        indexDigest:
          "sha256:f5d48a77a99ae90eff47aa3be11d2c176285a86e94109aa49eb9319587889248",
        packs: 1,
        reproducedPacks: 1,
        registryId: "mcpatch-registry",
        reused: false,
        sourceCommit: fixture.registryCommit,
      },
    });
    expect(
      run(["registry", "publish", root], registryEnvironment()),
    ).toMatchObject({
      status: 0,
      stdout: { status: "published", reused: true },
    });
    const output = (first.stdout as { artifact: string }).artifact;
    const emitted = Buffer.concat(
      await Promise.all([
        readFile(join(output, "v1", "index.json")),
        readFile(join(output, "_headers")),
      ]),
    ).toString("utf8");
    expect(emitted).not.toContain(
      registryEnvironment().MCPATCH_REGISTRY_PRIVATE_KEY,
    );
    expect(emitted).not.toContain("Example title");
  });

  it("refuses dirty publication trees and mismatched reviewed authority", async () => {
    const dirtyRoot = await temporaryDirectory();
    await createPublicationFixture(dirtyRoot);
    await writeFile(join(dirtyRoot, "unreviewed.txt"), "unreviewed");
    expect(
      run(["registry", "publish", dirtyRoot], registryEnvironment()),
    ).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "SOURCE_UNATTRIBUTED",
        field: "repository",
      },
    });

    const sourceRoot = await temporaryDirectory();
    const sourceFixture = await createPublicationFixture(sourceRoot);
    await writeFile(
      join(sourceFixture.sourceDirectory, "README.md"),
      "unreviewed source change",
    );
    expect(
      run(["registry", "publish", sourceRoot], registryEnvironment()),
    ).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "SOURCE_UNATTRIBUTED",
        field: "repository",
      },
    });

    const reviewRoot = await temporaryDirectory();
    const reviewFixture = await createPublicationFixture(reviewRoot);
    const review = JSON.parse(
      await readFile(reviewFixture.reviewPath, "utf8"),
    ) as { authority: { tools: Array<{ description: string }> } };
    const tool = review.authority.tools[0];
    if (tool === undefined) throw new Error("review tool missing");
    tool.description = "deceptive replacement";
    await writeFile(reviewFixture.reviewPath, `${JSON.stringify(review)}\n`);
    git(reviewRoot, ["add", "reviews"]);
    git(reviewRoot, ["commit", "-qm", "test: substitute review"]);
    expect(
      run(["registry", "publish", reviewRoot], registryEnvironment()),
    ).toMatchObject({
      status: 1,
      stderr: {
        status: "error",
        code: "REVIEW_REPORT_INVALID",
        field: "registry.packs.reviewReport",
      },
    });
  });
});

async function createPublicationFixture(root: string): Promise<{
  readonly registryCommit: string;
  readonly reviewPath: string;
  readonly sourceDirectory: string;
}> {
  await mkdir(root, { recursive: true });
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "MCPatch Test"]);
  git(root, ["config", "user.email", "mcpatch@example.invalid"]);
  await writeFile(join(root, ".gitignore"), "/registry-dist/\n/sources/\n");
  const sources = join(root, "sources");
  await mkdir(sources);
  const pack = await createPack(join(sources, "registry-reader"));
  commitPack(pack);
  const submitted = run(["pack", "submit", pack]);
  if (submitted.status !== 0) throw new Error("pack submission failed");
  const submission = submitted.stdout as { artifact: string; review: string };
  const content = parseDeclarativePackBundleContentBytes(
    await readFile(submission.artifact),
  );
  const signed = await signDeclarativePackBundle(content, publisherKeys());
  const inputs = join(root, "inputs");
  const reviews = join(root, "reviews");
  await mkdir(inputs);
  await mkdir(reviews);
  const bundlePath = join(inputs, "registry-reader.mcpack");
  const reviewPath = join(reviews, "registry-reader.review.json");
  await writeFile(bundlePath, serializeDeclarativePackBundle(signed));
  await copyFile(submission.review, reviewPath);
  await writeFile(
    join(root, "mcpatch.registry.json"),
    `${JSON.stringify({
      registrySourceVersion: 2,
      registryId: "mcpatch-registry",
      publicationSequence: 8,
      issuedAt: "2026-09-17T00:00:00.000Z",
      expiresAt: "2026-09-24T00:00:00.000Z",
      packs: [
        {
          source: "sources/registry-reader",
          reviewReport: "reviews/registry-reader.review.json",
          bundle: "inputs/registry-reader.mcpack",
          publisherKey: encode(publisherKeys().publicKey),
          trust: "REVIEWED_COMMUNITY",
          verification: {
            verifiedAt: "2026-09-16T23:00:00.000Z",
            fixtureTestsPassed: 1,
            fixtureTestsTotal: 1,
            sourceCommit: content.metadata.sourceCommit,
          },
          revocation: { status: "ACTIVE" },
        },
      ],
    })}\n`,
  );
  git(root, [
    "add",
    ".gitignore",
    "inputs",
    "reviews",
    "mcpatch.registry.json",
  ]);
  git(root, ["commit", "-qm", "test: add reviewed publication"]);
  return {
    registryCommit: gitOutput(root, ["rev-parse", "HEAD"]),
    reviewPath,
    sourceDirectory: pack,
  };
}

async function createRegistryFixture(root: string): Promise<{
  readonly bundlePath: string;
  readonly registry: string;
  readonly signedBundle: Buffer;
}> {
  await mkdir(root, { recursive: true });
  const pack = await createPack(join(root, "registry-reader"));
  commitPack(pack);
  const built = run(["pack", "build", pack]);
  if (built.status !== 0) throw new Error("pack build failed");
  const unsignedPath = (built.stdout as { artifact: string }).artifact;
  const content = parseDeclarativePackBundleContentBytes(
    await readFile(unsignedPath),
  );
  const signed = await signDeclarativePackBundle(content, publisherKeys());
  const signedBundle = Buffer.from(serializeDeclarativePackBundle(signed));
  const registry = join(root, "registry");
  const inputs = join(registry, "inputs");
  await mkdir(inputs, { recursive: true });
  const bundlePath = join(inputs, "registry-reader.mcpack");
  await writeFile(bundlePath, signedBundle);
  await writeFile(
    join(registry, "mcpatch.registry.json"),
    `${JSON.stringify({
      registrySourceVersion: 1,
      registryId: "mcpatch-registry",
      publicationSequence: 7,
      issuedAt: "2026-09-16T23:00:00.000Z",
      expiresAt: "2026-09-24T23:00:00.000Z",
      packs: [
        {
          bundle: "inputs/registry-reader.mcpack",
          publisherKey: encode(publisherKeys().publicKey),
          trust: "REVIEWED_COMMUNITY",
          verification: {
            verifiedAt: "2026-09-16T22:00:00.000Z",
            fixtureTestsPassed: 1,
            fixtureTestsTotal: 1,
            sourceCommit: content.metadata.sourceCommit,
          },
          revocation: { status: "ACTIVE" },
        },
      ],
    })}\n`,
  );
  return { bundlePath, registry, signedBundle };
}

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
  git(target, ["add", "."]);
  git(target, ["commit", "-qm", "test: add pack"]);
}

function gitOutput(directory: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function git(directory: string, args: readonly string[]): void {
  execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-09-17T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-09-17T00:00:00Z",
    },
    stdio: "pipe",
  });
}

function run(
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): {
  readonly rawStderr: string;
  readonly rawStdout: string;
  readonly status: number | null;
  readonly stderr?: unknown;
  readonly stdout?: unknown;
} {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dirname(CLI),
    encoding: "utf8",
    env: { ...process.env, ...environment, NO_COLOR: "1" },
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

function registryEnvironment(): Readonly<Record<string, string>> {
  return {
    MCPATCH_REGISTRY_PRIVATE_KEY: encode(registryKeys().privateKey),
    MCPATCH_REGISTRY_PUBLIC_KEY: encode(registryKeys().publicKey),
  };
}

function registryKeys() {
  return {
    privateKey: hex(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    ),
    publicKey: hex(
      "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8",
    ),
  };
}

function publisherKeys() {
  return {
    privateKey: hex(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    ),
    publicKey: hex(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    ),
  };
}

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}
