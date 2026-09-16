import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

const executeFile = promisify(execFile);
const require = createRequire(import.meta.url);
const extensionDirectory = new URL("../", import.meta.url);
const repositoryDirectory = new URL("../../../", import.meta.url);
const distributionDirectory = new URL(
  ".artifacts/chromium-fixture-extension/",
  repositoryDirectory,
);
const productionDirectory = new URL("dist/", extensionDirectory);
const fixtureDirectory = new URL("e2e/", extensionDirectory);
const protocolEntry = fileURLToPath(
  new URL("packages/protocol/src/index.ts", repositoryDirectory),
);
const sdkRuntimeEntry = fileURLToPath(
  new URL("packages/sdk/src/runtime.ts", repositoryDirectory),
);
const examplePacksEntry = fileURLToPath(
  new URL("packs/examples/src/index.ts", repositoryDirectory),
);
const googleFlightsPackEntry = fileURLToPath(
  new URL("packs/google-flights/src/index.ts", repositoryDirectory),
);
const marker = "MCPATCH_CHROMIUM_FIXTURE_ONLY";
const fixtureOrigin = "https://fixture.mcpatch.test";

await assertProductionArtifact();
await rm(distributionDirectory, { recursive: true, force: true });
await mkdir(distributionDirectory, { recursive: true });

const manifest = JSON.parse(
  await readFile(new URL("manifest.json", extensionDirectory), "utf8"),
);
manifest.name = "MCPatch Chromium fixture";
manifest.description = "Test-only MCPatch fixture runtime; never ship.";
delete manifest.optional_host_permissions;
delete manifest.options_ui;
manifest.host_permissions = [`${fixtureOrigin}/*`];
await writeFile(
  new URL("manifest.json", distributionDirectory),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "wx", mode: 0o600 },
);

const sharedBuildOptions = {
  alias: {
    "@mcpatch/example-packs": examplePacksEntry,
    "@mcpatch/google-flights-pack": googleFlightsPackEntry,
    "@mcpatch/protocol": protocolEntry,
    "@mcpatch/sdk/runtime": sdkRuntimeEntry,
  },
  bundle: true,
  banner: { js: `/* ${marker} */` },
  legalComments: "none",
  outdir: fileURLToPath(distributionDirectory),
  platform: "browser",
  sourcemap: false,
  target: "chrome106",
};

await build({
  ...sharedBuildOptions,
  entryPoints: {
    "content-script": fileURLToPath(
      new URL("fixture-content-script.ts", fixtureDirectory),
    ),
  },
  format: "iife",
});
await build({
  ...sharedBuildOptions,
  entryPoints: {
    "fixture-control": fileURLToPath(
      new URL("fixture-control.ts", fixtureDirectory),
    ),
    "service-worker": fileURLToPath(
      new URL("fixture-service-worker.ts", fixtureDirectory),
    ),
  },
  format: "esm",
});

await copyFile(
  new URL("fixture-control.html", fixtureDirectory),
  new URL("fixture-control.html", distributionDirectory),
);
const tailwindPackage = require.resolve("@tailwindcss/cli/package.json");
await executeFile(
  process.execPath,
  [
    resolve(dirname(tailwindPackage), "dist/index.mjs"),
    "--input",
    fileURLToPath(new URL("fixture.css", fixtureDirectory)),
    "--output",
    fileURLToPath(new URL("fixture.css", distributionDirectory)),
    "--minify",
  ],
  {
    cwd: fileURLToPath(repositoryDirectory),
    env: { ...process.env, NO_COLOR: "1" },
  },
);

for (const artifact of [
  "content-script.js",
  "fixture-control.js",
  "service-worker.js",
]) {
  const source = await readFile(
    new URL(artifact, distributionDirectory),
    "utf8",
  );
  if (!source.includes(marker)) {
    throw new Error(`${artifact} is missing the fixture-only marker`);
  }
  if (/\b(?:eval|Function)\s*\(/u.test(source)) {
    throw new Error(`${artifact} contains prohibited dynamic code generation`);
  }
  if (
    artifact === "content-script.js" &&
    !source.startsWith(`/* ${marker} */\n"use strict";\n(() => {`)
  ) {
    throw new Error("fixture content script is not isolated in an IIFE");
  }
}

async function assertProductionArtifact() {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", productionDirectory), "utf8"),
  );
  if (
    manifest.name !== "MCPatch" ||
    Object.hasOwn(manifest, "host_permissions") ||
    JSON.stringify(manifest).includes(fixtureOrigin)
  ) {
    throw new Error(
      "production extension must be built before fixture extension",
    );
  }
  for (const artifact of ["content-script.js", "service-worker.js"]) {
    const source = await readFile(
      new URL(artifact, productionDirectory),
      "utf8",
    );
    if (source.includes(marker) || source.includes(fixtureOrigin)) {
      throw new Error(`fixture seam leaked into production ${artifact}`);
    }
  }
}
