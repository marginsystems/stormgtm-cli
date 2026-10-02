import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_API_URL } from "../config.js";
import { loginWithBrowser } from "./auth.js";

test("login --key verifies and saves a legacy API key", async () => {
  const requests: Array<{ url: string | undefined; authorization: string | undefined }> = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ email: "legacy@example.test" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const home = mkdtempSync(path.join(tmpdir(), "stormgtm-cli-auth-"));
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", "process.stdout.isTTY = true; await import('./src/cli.ts')", "src/cli.ts", "login", "--key"], {
      cwd: packageRoot,
      env: { ...process.env, HOME: home, STORMGTM_API_URL: `http://127.0.0.1:${address.port}` },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end("lq_live_legacykey\n");
    });
    assert.equal(output.code, 0, output.stderr);
    assert.match(output.stdout, /Verified legacy@example\.test/);
    assert.equal(output.stdout.includes("lq_live_legacykey"), false);
    assert.deepEqual(requests, [{ url: "/v1/me", authorization: "Bearer lq_live_legacykey" }]);
    assert.equal(JSON.parse(readFileSync(path.join(home, ".stormgtm", "config.json"), "utf8")).apiKey, "lq_live_legacykey");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(home, { recursive: true, force: true });
  }
});

test("login --key replaces a stale API URL when the environment selects the default", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "stormgtm-cli-auth-default-"));
  const configDirectory = path.join(home, ".stormgtm");
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(path.join(configDirectory, "config.json"), JSON.stringify({ apiUrl: "https://staging.example" }));
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const bootstrap = `process.stdout.isTTY = true; globalThis.fetch = async (input) => { if (String(input) !== "${DEFAULT_API_URL}/v1/me") throw new Error("unexpected API URL"); return new Response(JSON.stringify({ email: "default@example.test" }), { status: 200, headers: { "content-type": "application/json" } }); }; await import('./src/cli.ts')`;
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", bootstrap, "src/cli.ts", "login", "--key"], {
      cwd: packageRoot,
      env: { ...process.env, HOME: home, STORMGTM_API_URL: DEFAULT_API_URL },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end("sgtm_live_defaultkey\n");
    });
    assert.equal(output.code, 0, output.stderr);
    assert.equal(output.stdout.includes("sgtm_live_defaultkey"), false);
    assert.equal(JSON.parse(readFileSync(path.join(configDirectory, "config.json"), "utf8")).apiUrl, DEFAULT_API_URL);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("browser login replaces a stale API URL when the environment selects the default", async () => {
  const originalHome = process.env.HOME;
  const originalApiUrl = process.env.STORMGTM_API_URL;
  const originalPath = process.env.PATH;
  const originalFetch = globalThis.fetch;
  const home = mkdtempSync(path.join(tmpdir(), "stormgtm-cli-browser-auth-"));
  const configDirectory = path.join(home, ".stormgtm");
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(path.join(configDirectory, "config.json"), JSON.stringify({ apiUrl: "https://staging.example" }));
  const requests: string[] = [];
  process.env.HOME = home;
  process.env.STORMGTM_API_URL = DEFAULT_API_URL;
  process.env.PATH = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url === `${DEFAULT_API_URL}/api/cli/device`) {
      return new Response(JSON.stringify({ device_code: "device", user_code: "ABCD", verification_uri: DEFAULT_API_URL, interval: 1, expires_in: 10 }), { status: 200 });
    }
    if (url === `${DEFAULT_API_URL}/api/cli/device/token`) {
      return new Response(JSON.stringify({ api_key: "sgtm_live_browser" }), { status: 200 });
    }
    if (url === `${DEFAULT_API_URL}/v1/me`) return new Response(JSON.stringify({ email: "browser@example.test" }), { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    await loginWithBrowser();
    assert.deepEqual(requests, [
      `${DEFAULT_API_URL}/api/cli/device`,
      `${DEFAULT_API_URL}/api/cli/device/token`,
      `${DEFAULT_API_URL}/v1/me`,
    ]);
    assert.deepEqual(JSON.parse(readFileSync(path.join(configDirectory, "config.json"), "utf8")), {
      apiUrl: DEFAULT_API_URL,
      apiKey: "sgtm_live_browser",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalApiUrl === undefined) delete process.env.STORMGTM_API_URL;
    else process.env.STORMGTM_API_URL = originalApiUrl;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(home, { recursive: true, force: true });
  }
});
