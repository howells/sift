#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { Box, type Key, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useState } from "react";
import { checkGogAuth } from "./lib/auth.ts";
import {
	type AccountConfig,
	getConfigDir,
	isClaudeCliAvailable,
	type SiftConfig,
	saveConfig,
} from "./lib/config.ts";

type Step =
	| "welcome"
	| "accounts"
	| "account_name"
	| "account_email"
	| "account_group"
	| "account_verify"
	| "more_accounts"
	| "api_key"
	| "confirm"
	| "done";

function getLLMDisplayName(
	claudeAvailable: boolean | null,
	apiKey: string,
): string {
	if (claudeAvailable) {
		return "Claude CLI";
	}
	if (apiKey) {
		return "Anthropic API";
	}
	return "None configured!";
}

function Setup() {
	const { exit } = useApp();
	const [step, setStep] = useState<Step>("welcome");
	const [accounts, setAccounts] = useState<AccountConfig[]>([]);
	const [currentAccount, setCurrentAccount] = useState<Partial<AccountConfig>>(
		{},
	);
	const [apiKey, setApiKey] = useState("");
	const [inputValue, setInputValue] = useState("");
	const [claudeAvailable, setClaudeAvailable] = useState<boolean | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Check Claude CLI on mount
	useEffect(() => {
		isClaudeCliAvailable().then(setClaudeAvailable);
	}, []);

	const handleMoreAccountsKey = (input: string, key: Key) => {
		if (input === "y") {
			setCurrentAccount({});
			setInputValue("");
			setStep("account_name");
		} else if (input === "n" || key.return) {
			setStep("api_key");
		}
	};

	const handleConfirmKey = () => {
		const config: SiftConfig = {
			accounts,
			anthropicApiKey: apiKey || undefined,
			preferClaudeCli: claudeAvailable === true,
		};
		saveConfig(config);
		setStep("done");
	};

	const handleSetupKey = (input: string, key: Key) => {
		const inputQuit =
			input === "q" &&
			step !== "account_name" &&
			step !== "account_email" &&
			step !== "account_group" &&
			step !== "api_key";

		if (inputQuit) {
			exit();
			return;
		}

		switch (step) {
			case "welcome": {
				if (key.return) {
					setStep("accounts");
				}
				break;
			}
			case "accounts": {
				if (key.return) {
					setStep("account_name");
				}
				break;
			}
			case "account_verify": {
				if (key.return) {
					setStep("more_accounts");
				}
				break;
			}
			case "more_accounts": {
				handleMoreAccountsKey(input, key);
				break;
			}
			case "confirm": {
				if (key.return) {
					handleConfirmKey();
				}
				break;
			}
			case "done": {
				if (key.return) {
					exit();
				}
				break;
			}
			default: {
				// no-op for other steps
			}
		}
	};

	useInput((input, key) => {
		handleSetupKey(input, key);
	});

	const handleSubmit = async (value: string) => {
		if (step === "account_name") {
			setCurrentAccount({ ...currentAccount, name: value });
			setInputValue("");
			setStep("account_email");
		} else if (step === "account_email") {
			const email = value;
			setCurrentAccount({ ...currentAccount, email });
			setInputValue("");

			// Verify gog auth for this email
			const isAuthed = await checkGogAuth(email);
			if (isAuthed) {
				setError(null);
				setStep("account_group");
			} else {
				setError(
					`Account "${email}" not found in gog.\nRun: gog auth add --account=${email}`,
				);
				setStep("account_verify");
			}
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
					<Box flexDirection="column" marginTop={1}>
						<Text dimColor>You'll need:</Text>
						<Text dimColor>• Gmail accounts authenticated with gog CLI</Text>
						<Text dimColor>• Optionally, an Anthropic API key</Text>
					</Box>
					<Box flexDirection="column" marginTop={1}>
						<Text dimColor>To authenticate a Gmail account with gog, run:</Text>
						<Text color="cyan">gog auth add --account=you@gmail.com</Text>
					</Box>
					<Box marginTop={1}>
						<Text>
							Press <Text color="cyan">Enter</Text> to continue,{" "}
							<Text color="cyan">q</Text> to quit
						</Text>
					</Box>
				</Box>
			)}

			{step === "accounts" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Step 1: Gmail Accounts</Text>
					<Box marginTop={1}>
						<Text>Add the Gmail accounts you want to monitor.</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Accounts must be authenticated with gog first.</Text>
					</Box>
					<Box marginTop={1}>
						<Text>
							Press <Text color="cyan">Enter</Text> to add an account
						</Text>
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
							onChange={setInputValue}
							onSubmit={handleSubmit}
							value={inputValue}
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
							onChange={setInputValue}
							onSubmit={handleSubmit}
							value={inputValue}
						/>
					</Box>
				</Box>
			)}

			{step === "account_group" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Account {accounts.length + 1}: Group</Text>
					<Text dimColor>
						Group name for filtering (e.g., "personal", "work")
					</Text>
					<Box marginTop={1}>
						<Text color="cyan">› </Text>
						<TextInput
							onChange={setInputValue}
							onSubmit={handleSubmit}
							value={inputValue}
						/>
					</Box>
				</Box>
			)}

			{step === "account_verify" && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="red">Account not authenticated with gog</Text>
					{error && (
						<Box marginTop={1}>
							<Text color="yellow">{error}</Text>
						</Box>
					)}
					<Box marginTop={1}>
						<Text dimColor>
							Authenticate the account with gog, then press Enter to retry.
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text>
							Press <Text color="cyan">Enter</Text> to continue
						</Text>
					</Box>
				</Box>
			)}

			{step === "more_accounts" && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="green">✓ Added: {accounts.at(-1)?.email}</Text>
					<Box marginTop={1}>
						<Text>Add another account? (y/n)</Text>
					</Box>
				</Box>
			)}

			{step === "api_key" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Step 2: Anthropic API Key (optional)</Text>
					<Box marginTop={1}>
						{claudeAvailable ? (
							<Text color="green">
								✓ Claude CLI detected - will use that by default
							</Text>
						) : (
							<Text color="yellow">
								Claude CLI not found - API key recommended
							</Text>
						)}
					</Box>
					<Box marginTop={1}>
						<Text dimColor>Leave blank to skip (requires Claude CLI)</Text>
					</Box>
					<Box marginTop={1}>
						<Text color="cyan">› </Text>
						<TextInput
							mask="*"
							onChange={setInputValue}
							onSubmit={handleSubmit}
							value={inputValue}
						/>
					</Box>
				</Box>
			)}

			{step === "confirm" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold>Configuration Summary</Text>
					<Box flexDirection="column" marginTop={1}>
						<Text>Accounts:</Text>
						{accounts.map((a) => (
							<Text dimColor key={a.email}>
								• {a.name} ({a.email}) - {a.group}
							</Text>
						))}
					</Box>
					<Box marginTop={1}>
						<Text>LLM: {getLLMDisplayName(claudeAvailable, apiKey)}</Text>
					</Box>
					<Box marginTop={1}>
						<Text>
							Config will be saved to:{" "}
							<Text color="yellow">{getConfigDir()}</Text>
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text>
							Press <Text color="cyan">Enter</Text> to save
						</Text>
					</Box>
				</Box>
			)}

			{step === "done" && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold color="green">
						✓ Setup complete!
					</Text>
					<Box marginTop={1}>
						<Text>
							Now run <Text color="cyan">sift</Text> to authenticate your
							accounts and start.
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text>
							Press <Text color="cyan">Enter</Text> to exit
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}

// Ensure config directory exists
const configDir = getConfigDir();
if (!existsSync(configDir)) {
	mkdirSync(configDir, { recursive: true });
}

render(<Setup />);
