import { google, Auth } from "googleapis";
import * as fs from "fs/promises";
import * as http from "http";
import open from "open";
import {
  loadConfig,
  getGoogleCredentialsPath,
  getTokenPath,
  getAccountGroups,
  type AccountConfig,
  type SiftConfig,
} from "./config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

// Re-export for backwards compatibility
export type { AccountConfig };

// Dynamic exports based on config
export function getAccounts(): AccountConfig[] {
  const config = loadConfig();
  return config?.accounts || [];
}

export function getAccountGroupsList(): string[] {
  const config = loadConfig();
  return config ? getAccountGroups(config) : [];
}

// Type for account groups (dynamic based on config)
export type AccountGroup = string;

async function loadCredentials(): Promise<{
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}> {
  const credPath = getGoogleCredentialsPath();
  const content = await fs.readFile(credPath, "utf-8");
  const { installed, web } = JSON.parse(content);
  return installed || web;
}

async function loadToken(accountName: string): Promise<object | null> {
  try {
    const tokenPath = getTokenPath(accountName);
    const content = await fs.readFile(tokenPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveToken(accountName: string, token: object): Promise<void> {
  const tokenPath = getTokenPath(accountName);
  await fs.writeFile(tokenPath, JSON.stringify(token, null, 2));
}

const AUTH_PORT = 9847;

async function getAuthCodeViaLocalServer(
  authUrl: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${AUTH_PORT}`);
      const code = url.searchParams.get("code");

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
              <div style="text-align: center;">
                <h1>✓ Authenticated</h1>
                <p>You can close this window and return to the terminal.</p>
              </div>
            </body>
          </html>
        `);
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing authorization code");
        server.close();
        reject(new Error("Missing authorization code"));
      }
    });

    server.listen(AUTH_PORT, () => {
      console.log("Opening browser for authentication...");
      open(authUrl);
    });

    server.on("error", reject);
  });
}

export async function getAuthenticatedClient(
  accountName: string
): Promise<Auth.OAuth2Client> {
  const credentials = await loadCredentials();
  const oauth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    `http://localhost:${AUTH_PORT}`
  );

  const existingToken = await loadToken(accountName) as { expiry_date?: number } | null;
  if (existingToken) {
    oauth2Client.setCredentials(existingToken);

    // Check if token needs refresh (expires in next 5 minutes)
    const expiryDate = existingToken.expiry_date;
    const isExpiring = expiryDate ? expiryDate < Date.now() + 5 * 60 * 1000 : false;

    if (isExpiring) {
      try {
        const { credentials: newToken } = await oauth2Client.refreshAccessToken();
        await saveToken(accountName, newToken);
        oauth2Client.setCredentials(newToken);
        return oauth2Client; // Return after successful refresh
      } catch (error) {
        console.log(`Token refresh failed for ${accountName}, re-authenticating...`);
        // Fall through to re-auth
      }
    } else {
      return oauth2Client;
    }
  }

  // Need to authenticate
  const accounts = getAccounts();
  const account = accounts.find((a) => a.name === accountName);
  console.log(`\nAuthenticating ${accountName} (${account?.email})...`);
  console.log("Please sign in with the correct Google account in the browser.\n");

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    login_hint: account?.email,
  });

  const code = await getAuthCodeViaLocalServer(authUrl);
  const { tokens } = await oauth2Client.getToken(code);
  await saveToken(accountName, tokens);
  oauth2Client.setCredentials(tokens);

  console.log(`✓ ${accountName} authenticated successfully\n`);
  return oauth2Client;
}

export async function authenticateAllAccounts(): Promise<
  Map<string, Auth.OAuth2Client>
> {
  const clients = new Map<string, Auth.OAuth2Client>();
  const accounts = getAccounts();

  for (const account of accounts) {
    const client = await getAuthenticatedClient(account.name);
    clients.set(account.name, client);
  }

  return clients;
}

// CLI entry point for manual auth
if (import.meta.url === `file://${process.argv[1]}`) {
  const accounts = getAccounts();
  console.log("Gmail OAuth Authentication\n");
  console.log(`This will authenticate ${accounts.length} accounts.\n`);

  authenticateAllAccounts()
    .then(() => {
      console.log("\n✓ All accounts authenticated!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Authentication failed:", error);
      process.exit(1);
    });
}
