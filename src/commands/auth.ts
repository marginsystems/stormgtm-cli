import { spawn } from "node:child_process";
import { platform } from "node:os";
import { clearApiKey, configPath, loadConfig, resolveApiKey, resolveApiUrl, saveConfig } from "../config.js";
import { LoginError, makePost, pollDeviceLogin, startDeviceLogin } from "../device.js";
import { StormGTM, StormGTMError, type Me } from "../index.js";
import { readSecretLine } from "../secret-input.js";

export const KEY_PREFIX = "sgtm_live_";

export function browserCommand(os: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (os === "darwin") return { command: "open", args: [url] };
  if (os === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

function openBrowser(url: string): void {
  const { command, args } = browserCommand(platform(), url);
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    return;
  }
}

export async function loginWithKey(): Promise<void> {
  const key = (await readSecretLine(`Paste your StormGTM API key (${KEY_PREFIX}...): `)).trim();
  if (!key.startsWith(KEY_PREFIX) && !key.startsWith("lq_live_")) throw new Error(`Key should start with ${KEY_PREFIX} or lq_live_`);
  const config = loadConfig();
  const apiUrl = resolveApiUrl(process.env, config);
  let me: Me;
  try {
    me = await new StormGTM({ apiKey: key, baseUrl: apiUrl }).me();
  } catch (error) {
    if (error instanceof StormGTMError && error.status === 401) throw new Error("API key invalid or revoked. Key was not saved.");
    throw new Error(`Could not verify the API key against ${apiUrl}. Key was not saved.`);
  }
  saveConfig({ ...config, apiKey: key, apiUrl });
  console.log(`Verified ${me.email}. Key saved to ${configPath()}`);
}

export async function loginWithBrowser(onStartFailure = loginWithKey): Promise<void> {
  const config = loadConfig();
  const apiUrl = resolveApiUrl(process.env, config);
  const post = makePost(apiUrl);
  let start: Awaited<ReturnType<typeof startDeviceLogin>>;
  try {
    start = await startDeviceLogin(post);
  } catch (error) {
    if (error instanceof LoginError && error.code === "start_failed") return onStartFailure();
    throw error;
  }
  console.log("To sign in, open this URL and confirm the code:\n");
  console.log(`  ${start.verification_uri_complete}\n`);
  console.log(`  Code: ${start.user_code}\n`);
  openBrowser(start.verification_uri_complete);
  console.log("Waiting for approval...");
  const approval = await pollDeviceLogin({
    post,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    deviceCode: start.device_code,
    intervalSeconds: start.interval,
    expiresInSeconds: start.expires_in,
    onPending: () => process.stdout.write("."),
  });
  process.stdout.write("\n");
  saveConfig({ ...config, apiKey: approval.apiKey, apiUrl });
  try {
    const me = await new StormGTM({ apiKey: approval.apiKey, baseUrl: apiUrl }).me();
    console.log(`Logged in as ${me.email}. Key saved to ${configPath()}`);
  } catch {
    console.log(`Key saved to ${configPath()}, but it could not be confirmed against ${apiUrl}. Run \`stormgtm whoami\` to check.`);
  }
}

export async function cmdLogin(args: string[]): Promise<number> {
  try {
    if (args.includes("--key")) await loginWithKey();
    else await loginWithBrowser();
    return 0;
  } catch (error) {
    if (error instanceof LoginError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

export function cmdLogout(): number {
  if (clearApiKey()) console.log(`Logged out. Removed the stored API key from ${configPath()}`);
  else console.log("No stored API key to remove.");
  if (process.env.STORMGTM_API_KEY?.trim()) console.log("STORMGTM_API_KEY is still set in this environment.");
  return 0;
}

export async function cmdWhoami(args: string[]): Promise<number> {
  const key = resolveApiKey();
  if (!key) {
    console.error("Not logged in. Run `stormgtm login`.");
    return 1;
  }
  const apiUrl = resolveApiUrl();
  const me = await new StormGTM({ apiKey: key, baseUrl: apiUrl }).me();
  if (args.includes("--json")) {
    console.log(JSON.stringify({ email: me.email, credits: me.credits, apiUrl, configPath: configPath() }, null, 2));
    return 0;
  }
  console.log(`Email    ${me.email}`);
  console.log(`Credits  ${me.credits}`);
  console.log(`API      ${apiUrl}`);
  return 0;
}
