import { describe, expect, it } from "vitest";
import { getAccountGroups, isModelConfigured, validateConfig } from "./config.ts";
import type { SiftConfig } from "./config.ts";

describe(getAccountGroups, () => {
  it("returns unique groups from accounts", () => {
    const config: SiftConfig = {
      accounts: [
        { email: "me@gmail.com", group: "personal", name: "personal" },
        { email: "me@work.com", group: "work", name: "work" },
        { email: "me@side.com", group: "work", name: "side" },
      ],
    };

    const groups = getAccountGroups(config);
    expect(groups).toHaveLength(2);
    expect(groups).toContain("personal");
    expect(groups).toContain("work");
  });

  it("returns empty array for no accounts", () => {
    const config: SiftConfig = { accounts: [] };
    expect(getAccountGroups(config)).toStrictEqual([]);
  });
});

describe(validateConfig, () => {
  it("returns no errors for valid config", () => {
    const config: SiftConfig = {
      accounts: [{ email: "test@test.com", group: "test", name: "test" }],
    };

    expect(validateConfig(config)).toStrictEqual([]);
  });

  it("returns error when no accounts configured", () => {
    const config: SiftConfig = { accounts: [] };
    const errors = validateConfig(config);
    expect(errors).toContain("No accounts configured");
  });

  it("returns errors for missing account fields", () => {
    const config: SiftConfig = {
      accounts: [
        { email: "test@test.com", group: "test", name: "" },
        { email: "", group: "test", name: "test" },
        { email: "test@test.com", group: "", name: "test" },
      ],
    };

    const errors = validateConfig(config);
    expect(errors).toContain("Account missing 'name'");
    expect(errors).toContain("Account missing 'email'");
    expect(errors).toContain("Account missing 'group'");
  });
});

describe(isModelConfigured, () => {
  it("is satisfied by an OpenRouter key", () => {
    expect(isModelConfigured({ OPENROUTER_API_KEY: "sk-or-v1-test" })).toBeTruthy();
  });

  it("rejects a missing or blank key", () => {
    expect(isModelConfigured({})).toBeFalsy();
    expect(isModelConfigured({ OPENROUTER_API_KEY: "  " })).toBeFalsy();
  });
});
