import { copyFile, mkdir, rm } from "node:fs/promises";
import { URL } from "node:url";

const distributionDirectory = new URL("../dist/", import.meta.url);

await rm(distributionDirectory, { recursive: true, force: true });
await mkdir(distributionDirectory, { recursive: true });
await copyFile(
  new URL("../manifest.json", import.meta.url),
  new URL("manifest.json", distributionDirectory),
);
