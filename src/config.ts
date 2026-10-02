import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_API_URL = "https://stormgtm.com";

export interface Config {
  apiKey?: string;
  apiUrl?: string;
}

export function configDir(): string {
  return path.join(homedir(), ".stormgtm");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): Config {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    const raw = parsed as Record<string, unknown>;
    const config: Config = {};
    if (typeof raw.apiKey === "string" && raw.apiKey.trim()) config.apiKey = raw.apiKey.trim();
    if (typeof raw.apiUrl === "string" && raw.apiUrl.trim()) config.apiUrl = raw.apiUrl.trim();
    return config;
  } catch {
    return {};
  }
}

export function saveConfig(config: Config): void {
  const file = configPath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
}

export function clearApiKey(): boolean {
  const config = loadConfig();
  if (!config.apiKey) return false;
  delete config.apiKey;
  if (config.apiUrl) saveConfig(config);
  else rmSync(configPath(), { force: true });
  return true;
}

export function resolveApiKey(env: NodeJS.ProcessEnv = process.env, config: Config = loadConfig()): string | undefined {
  return env.STORMGTM_API_KEY?.trim() || config.apiKey;
}

export function resolveApiUrl(env: NodeJS.ProcessEnv = process.env, config: Config = loadConfig()): string {
  return (env.STORMGTM_API_URL?.trim() || config.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
}
