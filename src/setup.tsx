#!/usr/bin/env node
import React, { useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import {
  saveConfig,
  getConfigDir,
  getGoogleCredentialsPath,
  getCredentialsDir,
  configExists,
  isClaudeCliAvailable,
  type SiftConfig,
  type AccountConfig,
} from "./lib/config.js";
import * as fs from "fs";
import * as path from "path";

type Step =
  | "welcome"
  | "google_creds"
  | "accounts"
  | "account_name"
  | "account_email"
  | "account_group"
  | "more_accounts"
  | "api_key"
  | "confirm"
  | "done";

function Setup() {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [accounts, setAccounts] = useState<AccountConfig[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Partial<AccountConfig>>({});
  const [apiKey, setApiKey] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [claudeAvailable, setClaudeAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check Claude CLI on mount
  React.useEffect(() => {
    isClaudeCliAvailable().then(setClaudeAvailable);
  }, []);

  useInput((input, key) => {
    if (input === "q" && step !== "account_name" && step !== "account_email" && step !== "account_group" && step !== "api_key") {
      exit();
    }

    if (step === "welcome" && key.return) {
      setStep("google_creds");
    }

    if (step === "google_creds" && key.return) {
      // Check if credentials file exists
      const credPath = getGoogleCredentialsPath();
      if (fs.existsSync(credPath)) {
        setStep("accounts");
      } else {
        setError(`Please place your Google OAuth credentials at:\n${credPath}`);
      }
    }

    if (step === "accounts" && key.return) {
      setStep("account_name");
    }

    if (step === "more_accounts") {
      if (input === "y") {
        setCurrentAccount({});
        setInputValue("");
        setStep("account_name");
      } else if (input === "n" || key.return) {
        setStep("api_key");
      }
    }

    if (step === "confirm" && key.return) {
      // Save config
      const config: SiftConfig = {
        accounts,
        anthropicApiKey: apiKey || undefined,
        preferClaudeCli: claudeAvailable === true,
      };
      saveConfig(config);
      setStep("done");
    }

    if (step === "done" && key.return) {
      exit();
    }
  });

  const handleSubmit = (value: string) => {
    if (step === "account_name") {
      setCurrentAccount({ ...currentAccount, name: value });
      setInputValue("");
      setStep("account_email");
    } else if (step === "account_email") {
      setCurrentAccount({ ...currentAccount, email: value });
      setInputValue("");
      setStep("account_group");
    } else if (step === "account_group") {
      const newAccount = { ...currentAccount, group: value } as AccountConfig;
      setAccounts([...accounts, newAccount]);
      setCurrentAccount({});
      setInputValue("");
      setStep("more_accounts");
    } else if (step === "api_key") {
      setApiKey(value);
      setInputValue("");
      setStep("confirm");
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        sift setup
      </Text>
      <Text dimColor>─────────────────────────────────────</Text>

      {step === "welcome" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Welcome to sift! Let's set things up.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>You'll need:</Text>
            <Text dimColor>• Google OAuth credentials (from Google Cloud Console)</Text>
            <Text dimColor>• Your Gmail account details</Text>
            <Text dimColor>• Optionally, an Anthropic API key</Text>
          </Box>
          <Box marginTop={1}>
            <Text>Press <Text color="cyan">Enter</Text> to continue, <Text color="cyan">q</Text> to quit</Text>
          </Box>
        </Box>
      )}

      {step === "google_creds" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Step 1: Google OAuth Credentials</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>1. Go to <Text color="cyan">https://console.cloud.google.com</Text></Text>
            <Text>2. Create a project and enable the Gmail API</Text>
            <Text>3. Create OAuth 2.0 credentials (Desktop app)</Text>
            <Text>4. Download the JSON and save it to:</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="yellow">{getGoogleCredentialsPath()}</Text>
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text>Press <Text color="cyan">Enter</Text> when ready</Text>
          </Box>
        </Box>
      )}

      {step === "accounts" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Step 2: Gmail Accounts</Text>
          <Box marginTop={1}>
            <Text>Add the Gmail accounts you want to monitor.</Text>
          </Box>
          <Box marginTop={1}>
            <Text>Press <Text color="cyan">Enter</Text> to add an account</Text>
          </Box>
        </Box>
      )}

      {step === "account_name" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Account {accounts.length + 1}: Name</Text>
          <Text dimColor>A short identifier (e.g., "personal", "work")</Text>
          <Box marginTop={1}>
            <Text color="cyan">› </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
            />
          </Box>
        </Box>
      )}

      {step === "account_email" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Account {accounts.length + 1}: Email</Text>
          <Text dimColor>The full Gmail address</Text>
          <Box marginTop={1}>
            <Text color="cyan">› </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
            />
          </Box>
        </Box>
      )}

      {step === "account_group" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Account {accounts.length + 1}: Group</Text>
          <Text dimColor>Group name for filtering (e.g., "personal", "work")</Text>
          <Box marginTop={1}>
            <Text color="cyan">› </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
            />
          </Box>
        </Box>
      )}

      {step === "more_accounts" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">✓ Added: {accounts[accounts.length - 1]?.email}</Text>
          <Box marginTop={1}>
            <Text>Add another account? (y/n)</Text>
          </Box>
        </Box>
      )}

      {step === "api_key" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Step 3: Anthropic API Key (optional)</Text>
          <Box marginTop={1}>
            {claudeAvailable ? (
              <Text color="green">✓ Claude CLI detected - will use that by default</Text>
            ) : (
              <Text color="yellow">Claude CLI not found - API key recommended</Text>
            )}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Leave blank to skip (requires Claude CLI)</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="cyan">› </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              mask="*"
            />
          </Box>
        </Box>
      )}

      {step === "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Configuration Summary</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>Accounts:</Text>
            {accounts.map((a, i) => (
              <Text key={i} dimColor>
                • {a.name} ({a.email}) - {a.group}
              </Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text>LLM: {claudeAvailable ? "Claude CLI" : apiKey ? "Anthropic API" : "None configured!"}</Text>
          </Box>
          <Box marginTop={1}>
            <Text>Config will be saved to: <Text color="yellow">{getConfigDir()}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text>Press <Text color="cyan">Enter</Text> to save</Text>
          </Box>
        </Box>
      )}

      {step === "done" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green" bold>✓ Setup complete!</Text>
          <Box marginTop={1}>
            <Text>Now run <Text color="cyan">sift</Text> to authenticate your accounts and start.</Text>
          </Box>
          <Box marginTop={1}>
            <Text>Press <Text color="cyan">Enter</Text> to exit</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// Ensure config directory exists
const configDir = getConfigDir();
const credDir = getCredentialsDir();
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}
if (!fs.existsSync(credDir)) {
  fs.mkdirSync(credDir, { recursive: true });
}

render(<Setup />);
