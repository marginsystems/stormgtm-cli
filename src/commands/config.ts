import { configPath, DEFAULT_API_URL, loadConfig, resolveApiUrl, saveConfig } from "../config.js";
import { CommandError, EXIT, usageError } from "../errors.js";
import { apiKeySource, apiUrlSource, keyDisplay, openBrowser, sourceLabel } from "./auth.js";

export const CONFIG_USAGE = "stormgtm config [show [--json] | path | set api-url <url> | unset api-url]";

export function normalizeApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CommandError(`Not a valid URL: ${value}`, EXIT.usage);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new CommandError("The API URL must start with https:// or http://", EXIT.usage);
  return url.toString().replace(/\/+$/, "");
}

function show(json: boolean): number {
  const config = loadConfig();
  const key = apiKeySource(process.env, config);
  const urlSource = apiUrlSource(process.env, config);
  const apiUrl = resolveApiUrl(process.env, config);
  if (json) {
    console.log(
      JSON.stringify(
        { apiUrl, apiUrlSource: urlSource, keyPrefix: key ? keyDisplay(key.key) : null, keySource: key?.source ?? null, configPath: configPath() },
        null,
        2,
      ),
    );
    return EXIT.ok;
  }
  console.log(`API      ${apiUrl} (${sourceLabel(urlSource, "STORMGTM_API_URL")})`);
  console.log(`Key      ${key ? `${keyDisplay(key.key)} (${sourceLabel(key.source, "STORMGTM_API_KEY")})` : "not set. Run `stormgtm login`."}`);
  console.log(`Config   ${configPath()}`);
  return EXIT.ok;
}

export function cmdConfig(args: string[]): number {
  const [action = "show", name, value] = args.filter((arg) => arg !== "--json");
  const json = args.includes("--json");
  if (action === "show") return show(json);
  if (action === "path") {
    console.log(configPath());
    return EXIT.ok;
  }
  if (action === "set" && name === "api-url" && value) {
    const apiUrl = normalizeApiUrl(value);
    saveConfig({ ...loadConfig(), apiUrl });
    console.log(`API URL set to ${apiUrl}`);
    if (process.env.STORMGTM_API_URL?.trim()) console.log("Note: STORMGTM_API_URL is set in this shell and takes precedence.");
    return EXIT.ok;
  }
  if (action === "unset" && name === "api-url" && !value) {
    const config = loadConfig();
    delete config.apiUrl;
    saveConfig(config);
    console.log(`API URL reset to ${DEFAULT_API_URL}`);
    return EXIT.ok;
  }
  throw usageError(CONFIG_USAGE);
}

export function cmdKeys(): number {
  const url = `${resolveApiUrl()}/app/keys`;
  console.log(`Manage your API keys at ${url}`);
  if (process.stdout.isTTY) openBrowser(url);
  return EXIT.ok;
}
