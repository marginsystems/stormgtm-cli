import { spawn } from "node:child_process";
import { platform } from "node:os";
import { clearApiKey, configPath, loadConfig, resolveApiUrl, saveConfig, type Config } from "../config.js";
import { LoginError, makePost, pollDeviceLogin, startDeviceLogin } from "../device.js";
import { CommandError, EXIT, NOT_LOGGED_IN, StormGTMError } from "../errors.js";
import { StormGTM, type Me } from "../index.js";
import { readSecretLine } from "../secret-input.js";

export const KEY_PREFIX = "sgtm_live_";
const LEGACY_KEY_PREFIX = "lq_live_";

export type Source = "env" | "config" | "default";

export function keyDisplay(key: string): string {
  const prefix = key.startsWith(KEY_PREFIX) ? KEY_PREFIX : key.startsWith(LEGACY_KEY_PREFIX) ? LEGACY_KEY_PREFIX : "";
  const visible = key.slice(0, Math.min(prefix.length + 4, Math.max(0, key.length - 1)));
  return `${visible}…`;
}

export function apiKeySource(env: NodeJS.ProcessEnv = process.env, config: Config = loadConfig()): { key: string; source: Exclude<Source, "default"> } | null {
  const fromEnv = env.STORMGTM_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  if (config.apiKey) return { key: config.apiKey, source: "config" };
  return null;
}

export function apiUrlSource(env: NodeJS.ProcessEnv = process.env, config: Config = loadConfig()): Source {
  if (env.STORMGTM_API_URL?.trim()) return "env";
  if (config.apiUrl) return "config";
  return "default";
}

export function sourceLabel(source: Source, variable: string): string {
  if (source === "env") return `from ${variable}`;
  if (source === "config") return `from ${configPath()}`;
  return "default";
}

export function browserCommand(os: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (os === "darwin") return { command: "open", args: [url] };
  if (os === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

export function openBrowser(url: string): void {
  const { command, args } = browserCommand(platform(), url);
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    return;
  }
}

function warnIfEnvOverrides(): void {
  if (process.env.STORMGTM_API_KEY?.trim()) console.log("Note: STORMGTM_API_KEY is set in this shell and takes precedence over the saved key.");
}

export async function loginWithKey(): Promise<void> {
  const key = (await readSecretLine(`Paste your StormGTM API key (${KEY_PREFIX}...): `)).trim();
  if (!key) throw new CommandError("No key entered. Create one at https://stormgtm.com/app/keys and run `stormgtm login --key` again.");
  if (!key.startsWith(KEY_PREFIX) && !key.startsWith(LEGACY_KEY_PREFIX)) throw new CommandError(`That doesn't look like a StormGTM API key. Keys start with ${KEY_PREFIX}.`);
  const config = loadConfig();
  const apiUrl = resolveApiUrl(process.env, config);
  let me: Me;
  try {
    me = await new StormGTM({ apiKey: key, baseUrl: apiUrl }).me();
  } catch (error) {
    if (error instanceof StormGTMError && error.status === 401) {
      throw new CommandError("API key invalid or revoked. Key was not saved. Check the key and run `stormgtm login --key` again.", EXIT.auth);
    }
    throw new CommandError(`Could not verify the API key against ${apiUrl}. Key was not saved.`);
  }
  saveConfig({ ...config, apiKey: key, apiUrl });
  console.log(`Verified ${me.email}. Key ${keyDisplay(key)} saved to ${configPath()}`);
  warnIfEnvOverrides();
}

export async function loginWithBrowser(): Promise<void> {
  const config = loadConfig();
  const apiUrl = resolveApiUrl(process.env, config);
  const post = makePost(apiUrl);
  const start = await startDeviceLogin(post);
  console.log("To sign in, open this URL and confirm the code:\n");
  console.log(`  ${start.verification_uri_complete}\n`);
  console.log(`  Code: ${start.user_code}\n`);
  openBrowser(start.verification_uri_complete);
  console.log("Waiting for approval…");
  const approval = await pollDeviceLogin({
    post,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    deviceCode: start.device_code,
    intervalSeconds: start.interval,
    expiresInSeconds: start.expires_in,
    onPending: () => process.stdout.write("."),
    keysUrl: `${apiUrl}/app/keys`,
  });
  process.stdout.write("\n");
  saveConfig({ ...config, apiKey: approval.apiKey, apiUrl });
  try {
    const me = await new StormGTM({ apiKey: approval.apiKey, baseUrl: apiUrl }).me();
    console.log(`Logged in as ${me.email}. Key ${keyDisplay(approval.apiKey)} saved to ${configPath()}`);
  } catch {
    console.log(`Key saved to ${configPath()}, but it could not be confirmed against ${apiUrl}. Run \`stormgtm whoami\` to check.`);
  }
  warnIfEnvOverrides();
}

export async function cmdLogin(args: string[]): Promise<number> {
  const unknown = args.find((arg) => arg !== "--key");
  if (unknown) throw new CommandError(`Unknown option for login: ${unknown}\nUsage: stormgtm login [--key]`, EXIT.usage);
  try {
    if (args.includes("--key")) await loginWithKey();
    else await loginWithBrowser();
    return EXIT.ok;
  } catch (error) {
    if (error instanceof LoginError) throw new CommandError(error.message, error.code === "rate_limited" ? EXIT.rateLimited : EXIT.failed);
    throw error;
  }
}

export function cmdLogout(): number {
  if (clearApiKey()) console.log(`Logged out. Removed the stored API key from ${configPath()}`);
  else console.log("Already logged out. No stored API key.");
  if (process.env.STORMGTM_API_KEY?.trim()) console.log("STORMGTM_API_KEY is still set in this shell. Unset it to fully log out.");
  return EXIT.ok;
}

export async function cmdWhoami(args: string[]): Promise<number> {
  const config = loadConfig();
  const found = apiKeySource(process.env, config);
  if (!found) throw new CommandError(NOT_LOGGED_IN, EXIT.auth);
  const apiUrl = resolveApiUrl(process.env, config);
  const me = await new StormGTM({ apiKey: found.key, baseUrl: apiUrl }).me();
  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        { email: me.email, credits: me.credits, keyPrefix: keyDisplay(found.key), keySource: found.source, apiUrl, configPath: configPath() },
        null,
        2,
      ),
    );
    return EXIT.ok;
  }
  console.log(`Email    ${me.email}`);
  console.log(`Credits  ${me.credits}`);
  console.log(`Key      ${keyDisplay(found.key)} (${sourceLabel(found.source, "STORMGTM_API_KEY")})`);
  console.log(`API      ${apiUrl}`);
  console.log(`Config   ${configPath()}`);
  return EXIT.ok;
}
