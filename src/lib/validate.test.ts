import { describe, expect, it } from "vitest";
import { validateFields, validateGroup, validateId } from "./validate.ts";

describe("validateId", () => {
	it("accepts valid Gmail thread IDs", () => {
		expect(validateId("19d42c92f393e035")).toEqual({ valid: true });
		expect(validateId("abc123")).toEqual({ valid: true });
		expect(validateId("reminder-abc-123")).toEqual({ valid: true });
	});

	it("rejects empty IDs", () => {
		const result = validateId("");
		expect(result.valid).toBe(false);
	});

	it("rejects IDs over 128 chars", () => {
		const result = validateId("a".repeat(129));
		expect(result.valid).toBe(false);
	});

	it("rejects control characters", () => {
		const result = validateId("abc\x00def");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain("control characters");
		}
	});

	it("rejects path traversal", () => {
		const result = validateId("../../../etc/passwd");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain("path traversal");
		}
	});

	it("rejects query params", () => {
		const result = validateId("abc?foo=bar");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain("query params");
		}
	});

	it("rejects hash fragments", () => {
		const result = validateId("abc#section");
		expect(result.valid).toBe(false);
	});

	it("rejects percent encoding", () => {
		const result = validateId("abc%2e%2e");
		expect(result.valid).toBe(false);
	});

	it("rejects spaces and special chars", () => {
		expect(validateId("abc def").valid).toBe(false);
		expect(validateId("abc@def").valid).toBe(false);
		expect(validateId("abc;def").valid).toBe(false);
	});
});

describe("validateGroup", () => {
	const validGroups = ["personal", "work", "siteinspire"];

	it("accepts valid groups", () => {
		expect(validateGroup("personal", validGroups)).toEqual({ valid: true });
		expect(validateGroup("siteinspire", validGroups)).toEqual({ valid: true });
	});

	it("rejects unknown groups", () => {
		const result = validateGroup("nonexistent", validGroups);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain("Unknown group");
			expect(result.error).toContain("personal");
		}
	});

	it("rejects empty groups", () => {
		const result = validateGroup("", validGroups);
		expect(result.valid).toBe(false);
	});
});

describe("validateFields", () => {
	const validFields = [
		"id",
		"summary",
		"urgency",
		"person",
		"deadline",
		"account",
	];

	it("accepts valid field lists", () => {
		expect(validateFields("id,summary,urgency", validFields)).toEqual({
			valid: true,
		});
	});

	it("accepts single fields", () => {
		expect(validateFields("id", validFields)).toEqual({ valid: true });
	});

	it("rejects unknown fields", () => {
		const result = validateFields("id,foobar,summary", validFields);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain("foobar");
		}
	});

	it("trims whitespace around fields", () => {
		expect(validateFields("id , summary , urgency", validFields)).toEqual({
			valid: true,
		});
	});
});
