#!/usr/bin/env node

import { runCli } from "./cli.js";

process.exitCode = await runCli(process.argv.slice(2), {
  currentDirectory: process.cwd(),
  environment: process.env,
  stderr: process.stderr,
  stdout: process.stdout,
});
