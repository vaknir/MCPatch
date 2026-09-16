import {
  constants,
  link,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { MAX_DECLARATIVE_BUNDLE_BYTES } from "@mcpatch/sdk";

import { cliError } from "./errors.js";
import { PACK_SOURCE_FILE, type LoadedPackSource } from "./model.js";

const MAX_SOURCE_BYTES = MAX_DECLARATIVE_BUNDLE_BYTES;

export function resolveTargetDirectory(
  value: string | undefined,
  currentDirectory: string,
): string {
  const candidate = value ?? ".";
  if (candidate.length === 0 || candidate.includes("\0")) {
    cliError("UNSAFE_PATH", "target");
  }
  return resolve(currentDirectory, candidate);
}

export async function loadPackSource(
  targetDirectory: string,
): Promise<LoadedPackSource> {
  await requireDirectory(targetDirectory, "target");
  const sourcePath = join(targetDirectory, PACK_SOURCE_FILE);
  let pathMetadata;
  try {
    pathMetadata = await lstat(sourcePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) cliError("SOURCE_NOT_FOUND", "$source");
    throw error;
  }
  if (
    pathMetadata.isSymbolicLink() ||
    !pathMetadata.isFile() ||
    pathMetadata.size > MAX_SOURCE_BYTES
  ) {
    cliError("UNSAFE_PATH", "$source");
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(sourcePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (isNodeError(error, "ELOOP")) cliError("UNSAFE_PATH", "$source");
    throw error;
  }
  let bytes: Buffer;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_SOURCE_BYTES) {
      cliError("UNSAFE_PATH", "$source");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    cliError("SOURCE_INVALID", "$source");
  }
  return Object.freeze({
    bytes,
    sourcePath,
    targetDirectory,
  });
}

export async function createScaffold(
  targetDirectory: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const parent = dirname(targetDirectory);
  await requireDirectory(parent, "target.parent");
  try {
    await lstat(targetDirectory);
    cliError("TARGET_EXISTS", "target");
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }

  const staging = join(
    parent,
    `.${basename(targetDirectory)}.mcpatch-create-${process.pid}`,
  );
  try {
    await mkdir(staging, { mode: 0o700 });
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      cliError("WRITE_INTERRUPTED", "target");
    }
    throw error;
  }

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      if (
        relativePath.includes("/") ||
        relativePath.includes("\\") ||
        relativePath === "." ||
        relativePath === ".."
      ) {
        cliError("INTERNAL_ERROR");
      }
      await writeFile(join(staging, relativePath), content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    }
    await rename(staging, targetDirectory);
  } catch (error) {
    await rm(staging, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }
}

export interface ArtifactWriteResult {
  readonly path: string;
  readonly reused: boolean;
}

export async function writeArtifact(
  targetDirectory: string,
  filename: string,
  bytes: Uint8Array,
): Promise<ArtifactWriteResult> {
  if (!/^[a-z0-9.-]+\.mcpack$/u.test(filename)) {
    cliError("INTERNAL_ERROR");
  }
  const outputDirectory = join(targetDirectory, "dist");
  await ensureOutputDirectory(outputDirectory);
  const outputPath = join(outputDirectory, filename);
  const stagingPath = join(outputDirectory, `.${filename}.tmp`);
  if (await pathExists(stagingPath)) {
    cliError("WRITE_INTERRUPTED", "dist");
  }

  let handle;
  try {
    handle = await open(
      stagingPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      cliError("WRITE_INTERRUPTED", "dist");
    }
    throw error;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await link(stagingPath, outputPath);
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
    const existing = await readSafeRegularFile(outputPath);
    if (!Buffer.from(existing).equals(Buffer.from(bytes))) {
      await unlink(stagingPath).catch(() => undefined);
      cliError("OUTPUT_DIRTY", "dist");
    }
    await unlink(stagingPath);
    return Object.freeze({ path: outputPath, reused: true });
  }
  await unlink(stagingPath);
  return Object.freeze({ path: outputPath, reused: false });
}

async function ensureOutputDirectory(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      cliError("UNSAFE_PATH", "dist");
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (createError) {
      if (!isNodeError(createError, "EEXIST")) throw createError;
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        cliError("UNSAFE_PATH", "dist");
      }
    }
  }
}

async function requireDirectory(path: string, field: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) cliError("SOURCE_NOT_FOUND", field);
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    cliError("UNSAFE_PATH", field);
  }
}

async function readSafeRegularFile(path: string): Promise<Uint8Array> {
  const pathMetadata = await lstat(path);
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile()) {
    cliError("UNSAFE_PATH", "dist");
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (isNodeError(error, "ELOOP")) cliError("UNSAFE_PATH", "dist");
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) cliError("UNSAFE_PATH", "dist");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
