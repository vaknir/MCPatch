import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { cliError } from "./errors.js";

const execute = promisify(execFile);
const COMMIT = /^[a-f0-9]{40,64}$/u;

/** Returns the exact clean commit that contains the fixed pack source file. */
export async function sourceCommit(
  targetDirectory: string,
  sourcePath: string,
  sourceBytes: Uint8Array,
): Promise<string> {
  const root = await git(targetDirectory, ["rev-parse", "--show-toplevel"]);
  const canonicalRoot = await realpath(resolve(root));
  const canonicalSource = await realpath(resolve(sourcePath));
  const sourceRelative = relative(canonicalRoot, canonicalSource);
  if (
    sourceRelative === "" ||
    sourceRelative === ".." ||
    sourceRelative.startsWith(`..${sep}`) ||
    sourceRelative.split(sep).includes(".git")
  ) {
    cliError("SOURCE_UNATTRIBUTED", "$source");
  }

  await git(canonicalRoot, [
    "ls-files",
    "--error-unmatch",
    "--",
    sourceRelative,
  ]);
  const committedBytes = await gitBytes(canonicalRoot, [
    "show",
    `HEAD:${sourceRelative.split(sep).join("/")}`,
  ]);
  if (!committedBytes.equals(Buffer.from(sourceBytes))) {
    cliError("SOURCE_UNATTRIBUTED", "$source");
  }
  const status = await git(canonicalRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    sourceRelative,
  ]);
  if (status !== "") cliError("SOURCE_UNATTRIBUTED", "$source");
  const commit = await git(canonicalRoot, ["rev-parse", "HEAD"]);
  if (!COMMIT.test(commit)) cliError("SOURCE_UNATTRIBUTED", "$source");
  return commit;
}

function gitBytes(directory: string, args: readonly string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolveBytes, rejectBytes) => {
    execFile(
      "git",
      ["-C", directory, ...args],
      {
        encoding: "buffer",
        env: gitEnvironment(),
        maxBuffer: 2 * 1024 * 1024,
        timeout: 5_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          rejectBytes(error);
          return;
        }
        resolveBytes(stdout);
      },
    );
  }).catch(() => cliError("SOURCE_UNATTRIBUTED", "$source"));
}

async function git(
  directory: string,
  args: readonly string[],
): Promise<string> {
  try {
    const result = await execute("git", ["-C", directory, ...args], {
      encoding: "utf8",
      env: gitEnvironment(),
      maxBuffer: 64 * 1024,
      timeout: 5_000,
      windowsHide: true,
    });
    return result.stdout.trim();
  } catch {
    cliError("SOURCE_UNATTRIBUTED", "$source");
  }
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
  };
}
