import { runCli } from "../cli.ts";

export interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

class ExitInterception extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

/**
 * Run a sift CLI command in-process, capturing stdout, stderr and the
 * intended exit code without terminating the host process.
 *
 * The MCP server uses this to invoke commands without paying the cost of
 * spawning a fresh Node subprocess on every tool call.
 *
 * MCP transports serialize requests, so the global stdio interception is
 * safe as long as the host process does not have other concurrent writers
 * during the lifetime of `runCli`.
 */
export async function runSiftCommand(argv: string[]): Promise<CommandResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origExit = process.exit.bind(process);

  process.stdout.write = (chunk: unknown) => {
    stdout += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  };

  process.stderr.write = (chunk: unknown) => {
    stderr += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  };

  process.exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new ExitInterception(exitCode);
  };

  try {
    await runCli(argv);
  } catch (error) {
    if (!(error instanceof ExitInterception)) {
      throw error;
    }
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    process.exit = origExit;
  }

  return { exitCode, stderr, stdout };
}
