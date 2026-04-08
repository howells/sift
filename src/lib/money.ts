import { runCli as runLedgerCli } from "@howells/ledger";

export function buildMoneyUnavailable(source: "ledger" | "offledger"): {
	error: string;
	source: string;
} {
	return {
		error: `${source} not available`,
		source,
	};
}

function mapFlags(flags: Map<string, string | true>): string[] {
	const result: string[] = [];
	for (const [key, value] of flags.entries()) {
		if (value === true) {
			result.push(`--${key}`);
		} else {
			result.push(`--${key}=${value}`);
		}
	}
	return result;
}

export async function executeLedgerMoneyCommand(
	subcommand: string,
	flags: Map<string, string | true>,
): Promise<Record<string, unknown>> {
	try {
		const normalized =
			subcommand === "balance" || subcommand === "transactions"
				? subcommand
				: null;

		if (!normalized) {
			return buildMoneyUnavailable("offledger");
		}

		const result = await runLedgerCli([normalized, ...mapFlags(flags)]);

		if (!result.ok) {
			return {
				error: result.error,
				source: "ledger",
			};
		}

		return result.data;
	} catch {
		return buildMoneyUnavailable("ledger");
	}
}
