import { describe, expect, it } from "vitest";
import { buildToolDiscovery } from "./linear.ts";

describe("buildToolDiscovery", () => {
	it("includes non-wrapped tools", () => {
		const tools = buildToolDiscovery();
		expect(tools.some((tool) => tool.name === "gh")).toBe(true);
		expect(tools.some((tool) => tool.name === "vercel")).toBe(true);
	});
});
