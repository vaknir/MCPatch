import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { build } from "esbuild";

const extensionDirectory = new URL("../", import.meta.url);
const distributionDirectory = new URL("dist/", extensionDirectory);
const protocolEntry = fileURLToPath(
  new URL("../../../packages/protocol/src/index.ts", import.meta.url),
);
const sdkRuntimeEntry = fileURLToPath(
  new URL("../../../packages/sdk/src/runtime.ts", import.meta.url),
);
const examplePacksEntry = fileURLToPath(
  new URL("../../../packs/examples/src/index.ts", import.meta.url),
);
const googleFlightsPackEntry = fileURLToPath(
  new URL("../../../packs/google-flights/src/index.ts", import.meta.url),
);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", extensionDirectory), "utf8"),
);
const sourceCommit = process.env["MCPATCH_SOURCE_COMMIT"] ?? "development";
if (sourceCommit !== "development" && !/^[0-9a-f]{40}$/u.test(sourceCommit)) {
  throw new Error("MCPATCH_SOURCE_COMMIT must be a full lowercase Git commit");
}

await rm(distributionDirectory, { recursive: true, force: true });
await mkdir(distributionDirectory, { recursive: true });
await copyFile(
  new URL("manifest.json", extensionDirectory),
  new URL("manifest.json", distributionDirectory),
);
await writeFile(
  new URL("build-metadata.json", distributionDirectory),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      productVersion: manifest.version,
      sourceCommit,
    },
    null,
    2,
  )}\n`,
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
  legalComments: "none",
  outdir: fileURLToPath(distributionDirectory),
  platform: "browser",
  sourcemap: false,
  target: "chrome106",
};

// Registered content scripts are classic scripts even when the extension uses
// an ESM service worker. Keep every bundled symbol out of the page Window: a
// top-level name such as `status` otherwise aliases a browser global and can
// corrupt a validated pack definition before MCPatch starts.
await build({
  ...sharedBuildOptions,
  entryPoints: {
    "content-script": fileURLToPath(
      new URL("src/content-script.ts", extensionDirectory),
    ),
  },
  format: "iife",
});
await build({
  ...sharedBuildOptions,
  entryPoints: {
    "service-worker": fileURLToPath(
      new URL("src/service-worker.ts", extensionDirectory),
    ),
  },
  format: "esm",
});

for (const artifact of ["content-script.js", "service-worker.js"]) {
  const source = await readFile(
    new URL(artifact, distributionDirectory),
    "utf8",
  );
  if (/\b(?:eval|Function)\s*\(/u.test(source)) {
    throw new Error(`${artifact} contains prohibited dynamic code generation`);
  }
  if (
    artifact === "content-script.js" &&
    !/^"use strict";\n\(\(\) => \{/u.test(source)
  ) {
    throw new Error("content-script.js is not isolated in an IIFE");
  }
}
