import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const PRODUCT_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function validateArtifactIdentity({
  architecture,
  platform,
  productVersion,
  sourceCommit,
}) {
  if (!SOURCE_COMMIT_PATTERN.test(sourceCommit)) {
    throw new Error(
      "source commit must be 40 lowercase hexadecimal characters",
    );
  }
  if (!PRODUCT_VERSION_PATTERN.test(productVersion)) {
    throw new Error("product version must be SemVer");
  }
  if (
    !/^[a-z0-9_-]{1,32}$/u.test(platform) ||
    !/^[a-z0-9_-]{1,32}$/u.test(architecture)
  ) {
    throw new Error("platform and architecture must be bounded identifiers");
  }
}

export async function buildArtifactManifest({
  architecture,
  artifactDirectory,
  platform,
  productVersion,
  sourceCommit,
}) {
  validateArtifactIdentity({
    architecture,
    platform,
    productVersion,
    sourceCommit,
  });

  return {
    schemaVersion: 1,
    productVersion,
    sourceCommit,
    platform,
    architecture,
    artifacts: await describeFiles(artifactDirectory),
  };
}

export async function describeFiles(root) {
  const files = [];
  await visit(root, "", files);
  files.sort((left, right) => compareText(left.path, right.path));
  return files;
}

async function visit(root, relativeDirectory, files) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (relativePath === "artifact-manifest.json") {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(
        `artifact cannot contain symbolic link: ${toPortablePath(relativePath)}`,
      );
    }
    if (entry.isDirectory()) {
      await visit(root, relativePath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `artifact contains unsupported entry: ${toPortablePath(relativePath)}`,
      );
    }
    const absolutePath = path.join(root, relativePath);
    const [contents, metadata] = await Promise.all([
      readFile(absolutePath),
      stat(absolutePath),
    ]);
    files.push({
      path: toPortablePath(relativePath),
      size: metadata.size,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  }
}

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function compareText(left, right) {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
