import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
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

await rm(distributionDirectory, { recursive: true, force: true });
await mkdir(distributionDirectory, { recursive: true });
await copyFile(
  new URL("manifest.json", extensionDirectory),
  new URL("manifest.json", distributionDirectory),
);

await build({
  alias: {
    "@mcpatch/example-packs": examplePacksEntry,
    "@mcpatch/protocol": protocolEntry,
    "@mcpatch/sdk/runtime": sdkRuntimeEntry,
  },
  bundle: true,
  entryPoints: {
    "content-script": fileURLToPath(
      new URL("src/content-script.ts", extensionDirectory),
    ),
    "service-worker": fileURLToPath(
      new URL("src/service-worker.ts", extensionDirectory),
    ),
  },
  format: "esm",
  legalComments: "none",
  outdir: fileURLToPath(distributionDirectory),
  platform: "browser",
  sourcemap: false,
  target: "chrome106",
});

for (const artifact of ["content-script.js", "service-worker.js"]) {
  const source = await readFile(
    new URL(artifact, distributionDirectory),
    "utf8",
  );
  if (/\b(?:eval|Function)\s*\(/u.test(source)) {
    throw new Error(`${artifact} contains prohibited dynamic code generation`);
  }
}
