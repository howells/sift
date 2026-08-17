import { describe, expect, it, vi } from "vitest";
import { parseArgs, runCli } from "./cli.ts";

describe(parseArgs, () => {
  it("supports nested domain subcommands", () => {
    expect(parseArgs(["email", "list", "--group=personal"]).commandPath).toStrictEqual([
      "email",
      "list",
    ]);
    expect(parseArgs(["email", "done", "abc123"]).commandPath).toStrictEqual(["email", "done"]);
  });

  it("keeps legacy commands as a single command path", () => {
    expect(parseArgs(["list", "--group=personal"]).commandPath).toStrictEqual(["list"]);
  });

  it("treats describe as a top-level command", () => {
    expect(parseArgs(["describe", "list"]).commandPath).toStrictEqual(["describe"]);
  });
});

describe(runCli, () => {
  it("prints machine-readable schemas for describe", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["describe", "done"]);

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    const parsed = JSON.parse(output.trim()) as {
      command: string;
      schema: { kind: string };
    };

    expect(parsed.command).toBe("done");
    expect(parsed.schema.kind).toBe("write");
  });

  it("describes list as a read command", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runCli(["describe", "list"]);

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    const parsed = JSON.parse(output.trim()) as {
      command: string;
      schema: { kind: string };
    };

    expect(parsed.command).toBe("list");
    expect(parsed.schema.kind).toBe("read");
  });
});
