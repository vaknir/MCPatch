import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  buildArtifactManifest,
  describeFiles,
  validateArtifactIdentity,
} from "./artifact-metadata.mjs";

test("artifact manifest is deterministic, sorted, and commit attributable", async (context) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mcpatch-artifact-test-"));
  context.after(async () => rm(fixture, { recursive: true, force: true }));
  await mkdir(path.join(fixture, "extension"));
  await writeFile(path.join(fixture, "mcpatch"), "bridge");
  await writeFile(
    path.join(fixture, "extension", "manifest.json"),
    "extension",
  );

  const manifest = await buildArtifactManifest({
    architecture: "arm64",
    artifactDirectory: fixture,
    platform: "darwin",
    productVersion: "0.1.0",
    sourceCommit: "a".repeat(40),
  });

  assert.deepEqual(manifest, {
    schemaVersion: 1,
    productVersion: "0.1.0",
    sourceCommit: "a".repeat(40),
    platform: "darwin",
    architecture: "arm64",
    artifacts: [
      {
        path: "extension/manifest.json",
        size: 9,
        sha256: createHash("sha256").update("extension").digest("hex"),
      },
      {
        path: "mcpatch",
        size: 6,
        sha256: createHash("sha256").update("bridge").digest("hex"),
      },
    ],
  });
});

test("metadata rejects ambiguous identity fields and artifact symlinks", async (context) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mcpatch-artifact-test-"));
  context.after(async () => rm(fixture, { recursive: true, force: true }));
  await writeFile(path.join(fixture, "target"), "data");

  await assert.rejects(
    buildArtifactManifest({
      architecture: "arm64",
      artifactDirectory: fixture,
      platform: "darwin",
      productVersion: "version one",
      sourceCommit: "not-a-commit",
    }),
  );

  if (process.platform !== "win32") {
    await symlink(path.join(fixture, "target"), path.join(fixture, "linked"));
    await assert.rejects(describeFiles(fixture), /symbolic link/u);
  }
});

test("package identity accepts SemVer but rejects path-capable or ambiguous fields", () => {
  assert.doesNotThrow(() =>
    validateArtifactIdentity({
      architecture: "x64",
      platform: "linux",
      productVersion: "1.2.3-alpha.1+build.5",
      sourceCommit: "1".repeat(40),
    }),
  );
  for (const productVersion of ["../outside", "1.2.3/other", "1.2.3-01"]) {
    assert.throws(() =>
      validateArtifactIdentity({
        architecture: "x64",
        platform: "linux",
        productVersion,
        sourceCommit: "1".repeat(40),
      }),
    );
  }
  assert.throws(() =>
    validateArtifactIdentity({
      architecture: "x64; command",
      platform: "darwin",
      productVersion: "1.2.3",
      sourceCommit: "A".repeat(40),
    }),
  );
});
