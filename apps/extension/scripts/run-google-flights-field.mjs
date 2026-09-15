import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outputDirectory = await mkdtemp(
  join(tmpdir(), "mcpatch-google-flights-field-"),
);

let exitCode = 1;
let activeChild;
let resolveInterrupt;
const interrupted = new Promise((resolve) => {
  resolveInterrupt = resolve;
});
const interrupt = () => {
  activeChild?.kill("SIGINT");
  resolveInterrupt(130);
};
process.once("SIGINT", interrupt);
try {
  exitCode = await Promise.race([runPlaywright(outputDirectory), interrupted]);
} finally {
  process.off("SIGINT", interrupt);
  // Playwright creates an accessibility context on failures. The field policy
  // requires deleting even that transient artifact after the runner exits.
  await rm(outputDirectory, { recursive: true, force: true });
}
process.exitCode = exitCode;

function runPlaywright(output) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "playwright",
      [
        "test",
        "--config",
        "playwright.config.ts",
        "google-flights-field.spec.ts",
        "--output",
        output,
      ],
      {
        env: {
          ...process.env,
          MCPATCH_BROWSER_HEADED: "1",
          MCPATCH_REAL_SITE_SMOKE: "1",
        },
        stdio: "inherit",
      },
    );
    activeChild = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      activeChild = undefined;
      if (signal !== null) {
        reject(new Error(`Playwright exited from signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
