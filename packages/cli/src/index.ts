#!/usr/bin/env node

import { runCli } from "./cli.js";

process.exitCode = await runCli(process.argv.slice(2), {
  currentDirectory: process.cwd(),
  stderr: process.stderr,
  stdout: process.stdout,
});
