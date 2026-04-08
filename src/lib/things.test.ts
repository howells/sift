import { describe, expect, it } from "vitest";
import { buildThingsAddUrl } from "./things.ts";

describe("buildThingsAddUrl", () => {
	it("builds a Things add URL with the supported fields", () => {
		expect(
			buildThingsAddUrl({
				deadline: "2026-04-08",
				list: "Inbox",
				notes: "Follow up with client",
				title: "Call Acme",
				when: "today",
			}),
		).toBe(
			"things:///add?title=Call+Acme&notes=Follow+up+with+client&list=Inbox&when=today&deadline=2026-04-08",
		);
	});
});
