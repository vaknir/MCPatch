import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";

import {
  buildArtifactManifest,
  validateArtifactIdentity,
} from "./artifact-metadata.mjs";

const execute = promisify(execFile);
const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(path.join(repository, "package.json"), "utf8"),
);
const productVersion = packageJson.version;

await requireCleanRepository();
const sourceCommit = await git(["rev-parse", "--verify", "HEAD"]);
validateArtifactIdentity({
  architecture: process.arch,
  platform: process.platform,
  productVersion,
  sourceCommit,
});

await run("cargo", [
  "build",
  "--release",
  "--locked",
  "--package",
  "mcpatch-bridge",
]);
await runPnpm(["--filter", "@mcpatch/extension", "build"], {
  MCPATCH_SOURCE_COMMIT: sourceCommit,
});
await requireCleanRepository();

const executableName = process.platform === "win32" ? "mcpatch.exe" : "mcpatch";
const outputName = `mcpatch-${productVersion}-${process.platform}-${process.arch}`;
const artifactsRoot = path.join(repository, ".artifacts");
const outputDirectory = path.join(artifactsRoot, outputName);
const stagingDirectory = path.join(artifactsRoot, `.stage-${process.pid}`);
await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });

try {
  await cp(
    path.join(repository, "target", "release", executableName),
    path.join(stagingDirectory, executableName),
  );
  if (process.platform !== "win32") {
    await chmod(path.join(stagingDirectory, executableName), 0o755);
  }
  await cp(
    path.join(repository, "apps", "extension", "dist"),
    path.join(stagingDirectory, "extension"),
    {
      recursive: true,
      verbatimSymlinks: true,
    },
  );
  const artifactManifest = await buildArtifactManifest({
    architecture: process.arch,
    artifactDirectory: stagingDirectory,
    platform: process.platform,
    productVersion,
    sourceCommit,
  });
  await writeFile(
    path.join(stagingDirectory, "artifact-manifest.json"),
    `${JSON.stringify(artifactManifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await rm(outputDirectory, { recursive: true, force: true });
  await rename(stagingDirectory, outputDirectory);
  process.stdout.write(`${outputDirectory}\n`);
} catch (error) {
  await rm(stagingDirectory, { recursive: true, force: true });
  throw error;
}

async function requireCleanRepository() {
  const status = await git([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status !== "") {
    throw new Error("local packaging requires a clean source checkout");
  }
}

async function git(arguments_) {
  const { stdout } = await execute("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function run(command, arguments_, additionalEnvironment = {}) {
  await execute(command, arguments_, {
    cwd: repository,
    env: { ...process.env, ...additionalEnvironment },
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function runPnpm(arguments_, additionalEnvironment) {
  const pnpmEntrypoint = process.env["npm_execpath"];
  if (pnpmEntrypoint) {
    await run(
      process.execPath,
      [pnpmEntrypoint, ...arguments_],
      additionalEnvironment,
    );
  } else {
    await run(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      arguments_,
      additionalEnvironment,
    );
  }
}
