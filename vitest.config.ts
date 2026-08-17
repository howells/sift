import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // Replaces the per-file top-level `afterEach(vi.restoreAllMocks)` hooks,
    // which the lint preset rejects for sitting outside a describe block.
    restoreMocks: true,
  },
});
