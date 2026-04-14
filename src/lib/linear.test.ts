import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildToolDiscovery,
	getLinearApiKey,
	getLinearSummary,
} from "./linear.ts";

describe("buildToolDiscovery", () => {
	it("includes non-wrapped tools", () => {
		const tools = buildToolDiscovery();
		expect(tools.some((tool) => tool.name === "gh")).toBe(true);
		expect(tools.some((tool) => tool.name === "vercel")).toBe(true);
	});
});

describe("getLinearApiKey", () => {
	const originalLinear = process.env.LINEAR;

	beforeEach(() => {
		delete process.env.LINEAR;
	});

	afterEach(() => {
		if (originalLinear) {
			process.env.LINEAR = originalLinear;
		} else {
			delete process.env.LINEAR;
		}
	});

	it("reads the token from the environment", () => {
		process.env.LINEAR = "lin_api_test";
		expect(getLinearApiKey()).toBe("lin_api_test");
	});
});

describe("getLinearSummary", () => {
	const originalFetch = global.fetch;
	const originalLinear = process.env.LINEAR;

	beforeEach(() => {
		process.env.LINEAR = "lin_api_test";
	});

	afterEach(() => {
		global.fetch = originalFetch;
		if (originalLinear) {
			process.env.LINEAR = originalLinear;
		} else {
			delete process.env.LINEAR;
		}
	});

	it("counts started and unstarted assigned issues", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: {
						viewer: {
							assignedIssues: {
								nodes: [{ id: "1" }, { id: "2" }],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
			} as Response)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					data: {
						viewer: {
							assignedIssues: {
								nodes: [{ id: "3" }],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
			} as Response);

		global.fetch = fetchMock;

		await expect(getLinearSummary()).resolves.toEqual({
			in_progress: 2,
			todo: 1,
		});
	});
});
