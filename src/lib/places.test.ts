import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildPlacesUnavailable,
	executePlacesCommand,
	isGooglePlacesConfigured,
} from "./places.ts";

const { spawnSyncMock } = vi.hoisted(() => ({
	spawnSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: spawnSyncMock,
}));

describe("places helpers", () => {
	const originalPlacesKey = process.env.GOOGLE_PLACES_API_KEY;

	afterEach(() => {
		spawnSyncMock.mockReset();
		if (originalPlacesKey) {
			process.env.GOOGLE_PLACES_API_KEY = originalPlacesKey;
		} else {
			delete process.env.GOOGLE_PLACES_API_KEY;
		}
	});

	it("reports missing API key", () => {
		delete process.env.GOOGLE_PLACES_API_KEY;
		expect(isGooglePlacesConfigured()).toBe(false);
		expect(buildPlacesUnavailable("api-key")).toEqual({
			error: "GOOGLE_PLACES_API_KEY not configured",
			source: "goplaces",
		});
	});

	it("returns the parsed JSON payload", () => {
		process.env.GOOGLE_PLACES_API_KEY = "test-key";
		spawnSyncMock.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({
			error: undefined,
			status: 0,
			stderr: "",
			stdout: '{"places":[{"id":"abc123","displayName":{"text":"Cafe"}}]}',
		});

		expect(
			executePlacesCommand(
				"search",
				["coffee"],
				new Map<string, string | true>([
					["limit", "5"],
					["open-now", true],
				]),
			),
		).toEqual({
			places: [{ id: "abc123", displayName: { text: "Cafe" } }],
		});
	});
});
