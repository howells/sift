import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs, runCli } from "./cli.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("parseArgs", () => {
	it("supports nested domain subcommands", () => {
		expect(
			parseArgs(["money", "balance", "--source=stripe"]).commandPath,
		).toEqual(["money", "balance"]);
	});

	it("keeps legacy commands as a single command path", () => {
		expect(parseArgs(["list", "--group=personal"]).commandPath).toEqual([
			"list",
		]);
	});

	it("treats describe as a top-level command", () => {
		expect(parseArgs(["describe", "remind.add"]).commandPath).toEqual([
			"describe",
		]);
	});
});

describe("runCli", () => {
	it("prints machine-readable schemas for describe", async () => {
		const stdout = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await runCli(["describe", "remind.add"]);

		const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
		const parsed = JSON.parse(output.trim()) as {
			command: string;
			schema: { kind: string };
		};

		expect(parsed.command).toBe("remind.add");
		expect(parsed.schema.kind).toBe("write");
	});
});
