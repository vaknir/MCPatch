import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

import { build } from "esbuild";

const extensionDirectory = new URL("../", import.meta.url);
const distributionDirectory = new URL("dist/", extensionDirectory);
const protocolEntry = fileURLToPath(
  new URL("../../../packages/protocol/src/index.ts", import.meta.url),
);

await rm(distributionDirectory, { recursive: true, force: true });
await mkdir(distributionDirectory, { recursive: true });
await copyFile(
  new URL("manifest.json", extensionDirectory),
  new URL("manifest.json", distributionDirectory),
);

await build({
  alias: { "@mcpatch/protocol": protocolEntry },
  bundle: true,
  entryPoints: [
    fileURLToPath(new URL("src/service-worker.ts", extensionDirectory)),
  ],
  format: "esm",
  legalComments: "none",
  outfile: fileURLToPath(new URL("service-worker.js", distributionDirectory)),
  platform: "browser",
  sourcemap: false,
  target: "chrome105",
});
