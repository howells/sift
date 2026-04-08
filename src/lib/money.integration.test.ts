import { describe, expect, it } from "vitest";
import { buildMoneyUnavailable } from "./money.ts";

describe("buildMoneyUnavailable", () => {
	it("returns a stable unavailable payload", () => {
		expect(buildMoneyUnavailable("ledger")).toEqual({
			error: "ledger not available",
			source: "ledger",
		});
	});
});
