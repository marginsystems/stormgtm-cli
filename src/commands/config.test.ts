import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../cli.js";
import { configPath, saveConfig } from "../config.js";
import { CommandError, EXIT } from "../errors.js";
import { apiKeySource, keyDisplay } from "./auth.js";
import { cmdConfig, normalizeApiUrl } from "./config.js";

const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, STORMGTM_API_KEY: process.env.STORMGTM_API_KEY, STORMGTM_API_URL: process.env.STORMGTM_API_URL };

function restore(name: keyof typeof saved): void {
  if (saved[name] === undefined) delete process.env[name];
  else process.env[name] = saved[name];
}

beforeEach(() => {
  const home = mkdtempSync(path.join(tmpdir(), "sgtm-config-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.STORMGTM_API_KEY;
  delete process.env.STORMGTM_API_URL;
});

after(() => {
  for (const name of Object.keys(saved) as Array<keyof typeof saved>) restore(name);
});

function capture(run: () => number): { code: number; out: string } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => void lines.push(values.join(" "));
  try {
    return { code: run(), out: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

test("keys are shown by prefix only", () => {
  assert.equal(keyDisplay("sgtm_live_abcdef123456"), "sgtm_live_abcd…");
  assert.equal(keyDisplay("lq_live_abcdef"), "lq_live_abcd…");
  assert.equal(keyDisplay("sgtm_live_abcd"), "sgtm_live_abc…");
  assert.equal(keyDisplay("lq_live_abcd"), "lq_live_abc…");
  assert.equal(keyDisplay("abcd"), "abc…");
  assert.equal(keyDisplay("short"), "shor…");
});

test("the environment key wins over the saved key and reports its source", () => {
  assert.equal(apiKeySource({}, {}), null);
  assert.deepEqual(apiKeySource({}, { apiKey: "sgtm_live_file" }), { key: "sgtm_live_file", source: "config" });
  assert.deepEqual(apiKeySource({ STORMGTM_API_KEY: " sgtm_live_env " }, { apiKey: "sgtm_live_file" }), { key: "sgtm_live_env", source: "env" });
});

test("config set and unset api-url keep the saved key", () => {
  saveConfig({ apiKey: "sgtm_live_keepme" });
  assert.equal(capture(() => cmdConfig(["set", "api-url", "http://localhost:8787/"])).code, EXIT.ok);
  assert.deepEqual(JSON.parse(readFileSync(configPath(), "utf8")), { apiKey: "sgtm_live_keepme", apiUrl: "http://localhost:8787" });
  const shown = capture(() => cmdConfig(["--json"]));
  assert.deepEqual(JSON.parse(shown.out), { apiUrl: "http://localhost:8787", apiUrlSource: "config", keyPrefix: "sgtm_live_keep…", keySource: "config", configPath: configPath() });
  assert.equal(shown.out.includes("sgtm_live_keepme"), false);
  capture(() => cmdConfig(["unset", "api-url"]));
  assert.deepEqual(JSON.parse(readFileSync(configPath(), "utf8")), { apiKey: "sgtm_live_keepme" });
});

test("bad config input is a usage error", () => {
  assert.throws(() => normalizeApiUrl("stormgtm.com"), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.usage);
  assert.throws(() => normalizeApiUrl("ftp://stormgtm.com"), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.usage);
  assert.throws(() => cmdConfig(["set", "api-key", "x"]), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.usage);
});

test("help exits 0, unknown commands exit 3 before asking for a key, and whoami without a key exits 6", async () => {
  const original = console.log;
  console.log = () => undefined;
  try {
    assert.equal(await main([]), EXIT.ok);
    assert.equal(await main(["help"]), EXIT.ok);
  } finally {
    console.log = original;
  }
  await assert.rejects(main(["frobnicate"]), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.usage && /stormgtm help/.test(error.message));
  await assert.rejects(main(["whoami"]), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.auth);
  await assert.rejects(main(["status"]), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.auth);
  await assert.rejects(main(["login", "--token"]), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.usage);
  await assert.rejects(main(["outcome", "a@b.co", "sent"]), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.usage);
});
