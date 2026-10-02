import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearApiKey, configPath, DEFAULT_API_URL, loadConfig, resolveApiKey, resolveApiUrl, saveConfig } from "./config.js";
import { clientFromEnv, StormGTM } from "./index.js";

const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
let home = "";

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "sgtm-home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalProfile;
});

test("config lives in ~/.stormgtm/config.json with mode 0600", () => {
  saveConfig({ apiKey: "sgtm_live_abc", apiUrl: "https://api.example.test" });
  assert.equal(configPath(), path.join(home, ".stormgtm", "config.json"));
  assert.equal(statSync(configPath()).mode & 0o777, 0o600);
  assert.deepEqual(loadConfig(), { apiKey: "sgtm_live_abc", apiUrl: "https://api.example.test" });
  rmSync(home, { recursive: true, force: true });
});

test("saving over a looser file tightens it to 0600", () => {
  mkdirSync(path.join(home, ".stormgtm"));
  writeFileSync(configPath(), "{}", { mode: 0o644 });
  saveConfig({ apiKey: "sgtm_live_abc" });
  assert.equal(statSync(configPath()).mode & 0o777, 0o600);
});

test("a missing or malformed config reads as empty", () => {
  assert.deepEqual(loadConfig(), {});
  mkdirSync(path.join(home, ".stormgtm"));
  writeFileSync(configPath(), "not json");
  assert.deepEqual(loadConfig(), {});
  writeFileSync(configPath(), JSON.stringify({ apiKey: 7, apiUrl: " https://x.test " }));
  assert.deepEqual(loadConfig(), { apiUrl: "https://x.test" });
});

test("environment overrides the config file", () => {
  const config = { apiKey: "sgtm_live_file", apiUrl: "https://file.test/" };
  assert.equal(resolveApiKey({}, config), "sgtm_live_file");
  assert.equal(resolveApiKey({ STORMGTM_API_KEY: " sgtm_live_env " }, config), "sgtm_live_env");
  assert.equal(resolveApiUrl({}, config), "https://file.test");
  assert.equal(resolveApiUrl({ STORMGTM_API_URL: "https://env.test//" }, config), "https://env.test");
  assert.equal(resolveApiUrl({}, {}), DEFAULT_API_URL);
  assert.equal(DEFAULT_API_URL, "https://stormgtm.com");
});

test("clientFromEnv reads the environment, then the config file", () => {
  saveConfig({ apiKey: "sgtm_live_file", apiUrl: "https://file.test" });
  const fromFile = clientFromEnv({});
  assert.ok(fromFile instanceof StormGTM);
  assert.equal(fromFile.baseUrl, "https://file.test");
  const fromEnv = clientFromEnv({ STORMGTM_API_KEY: "sgtm_live_env", STORMGTM_API_URL: "https://env.test" });
  assert.equal(fromEnv.baseUrl, "https://env.test");
  rmSync(configPath());
  assert.throws(() => clientFromEnv({}), /stormgtm login/);
});

test("clearApiKey removes the key and the file when nothing else is stored", () => {
  assert.equal(clearApiKey(), false);
  saveConfig({ apiKey: "sgtm_live_abc" });
  assert.equal(clearApiKey(), true);
  assert.equal(existsSync(configPath()), false);
  saveConfig({ apiKey: "sgtm_live_abc", apiUrl: "https://api.example.test" });
  assert.equal(clearApiKey(), true);
  assert.deepEqual(JSON.parse(readFileSync(configPath(), "utf8")), { apiUrl: "https://api.example.test" });
});
