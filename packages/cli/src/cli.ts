import { errorReport } from "./errors.js";
import { executeCommand } from "./commands.js";

export interface CliIo {
  readonly currentDirectory: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly stderr: { write(value: string): unknown };
  readonly stdout: { write(value: string): unknown };
}

export async function runCli(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  try {
    const result = await executeCommand(args, {
      currentDirectory: io.currentDirectory,
      environment: io.environment ?? {},
    });
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${JSON.stringify(errorReport(error))}\n`);
    return 1;
  }
}
