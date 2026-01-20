import { describe, it, expect } from "vitest";
import { getAccountGroups, validateConfig, type SiftConfig } from "./config.js";

describe("getAccountGroups", () => {
  it("returns unique groups from accounts", () => {
    const config: SiftConfig = {
      accounts: [
        { name: "personal", email: "me@gmail.com", group: "personal" },
        { name: "work", email: "me@work.com", group: "work" },
        { name: "side", email: "me@side.com", group: "work" },
      ],
    };

    const groups = getAccountGroups(config);
    expect(groups).toHaveLength(2);
    expect(groups).toContain("personal");
    expect(groups).toContain("work");
  });

  it("returns empty array for no accounts", () => {
    const config: SiftConfig = { accounts: [] };
    expect(getAccountGroups(config)).toEqual([]);
  });
});

describe("validateConfig", () => {
  it("returns no errors for valid config", () => {
    const config: SiftConfig = {
      accounts: [{ name: "test", email: "test@test.com", group: "test" }],
      anthropicApiKey: "sk-ant-xxx",
    };

    expect(validateConfig(config)).toEqual([]);
  });

  it("returns error when no accounts configured", () => {
    const config: SiftConfig = { accounts: [] };
    const errors = validateConfig(config);
    expect(errors).toContain("No accounts configured");
  });

  it("returns errors for missing account fields", () => {
    const config: SiftConfig = {
      accounts: [
        { name: "", email: "test@test.com", group: "test" },
        { name: "test", email: "", group: "test" },
        { name: "test", email: "test@test.com", group: "" },
      ],
    };

    const errors = validateConfig(config);
    expect(errors).toContain("Account missing 'name'");
    expect(errors).toContain("Account missing 'email'");
    expect(errors).toContain("Account missing 'group'");
  });

  it("returns error when no API key and CLI disabled", () => {
    const config: SiftConfig = {
      accounts: [{ name: "test", email: "test@test.com", group: "test" }],
      preferClaudeCli: false,
    };

    const errors = validateConfig(config);
    expect(errors).toContain("No Anthropic API key and Claude CLI disabled");
  });

  it("allows no API key when CLI is preferred", () => {
    const config: SiftConfig = {
      accounts: [{ name: "test", email: "test@test.com", group: "test" }],
      preferClaudeCli: true,
    };

    expect(validateConfig(config)).toEqual([]);
  });
});
