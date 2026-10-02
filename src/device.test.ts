import { test } from "node:test";
import assert from "node:assert/strict";
import { LoginError, makePost, pollDeviceLogin, startDeviceLogin, type HttpReply } from "./device.js";
import { browserCommand, loginWithBrowser } from "./commands/auth.js";

function harness(replies: Array<HttpReply | Error>) {
  let clock = 0;
  const sleeps: number[] = [];
  const posts: Array<{ path: string; body: unknown }> = [];
  const queue = [...replies];
  return {
    sleeps,
    posts,
    options: {
      post: async (path: string, body: unknown) => {
        posts.push({ path, body });
        const next = queue.shift();
        if (!next) throw new Error("no reply queued");
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
      deviceCode: "dev_1",
      intervalSeconds: 5,
      expiresInSeconds: 600,
    },
  };
}

const pending: HttpReply = { status: 400, body: { error: "authorization_pending" } };

test("polls until approved and returns the key", async () => {
  const h = harness([pending, pending, { status: 200, body: { api_key: "sgtm_live_abc", key_prefix: "sgtm_live_ab" } }]);
  const approval = await pollDeviceLogin(h.options);
  assert.deepEqual(approval, { apiKey: "sgtm_live_abc", keyPrefix: "sgtm_live_ab" });
  assert.deepEqual(h.sleeps, [5000, 5000, 5000]);
  assert.deepEqual(h.posts[0], { path: "/api/cli/device/token", body: { device_code: "dev_1" } });
});

test("slow_down adds five seconds to every later wait", async () => {
  const h = harness([{ status: 400, body: { error: "slow_down" } }, pending, { status: 200, body: { api_key: "sgtm_live_abc" } }]);
  const approval = await pollDeviceLogin(h.options);
  assert.equal(approval.keyPrefix, undefined);
  assert.deepEqual(h.sleeps, [5000, 10000, 10000]);
});

test("terminal errors stop with a specific code", async () => {
  for (const code of ["expired_token", "access_denied", "already_redeemed"] as const) {
    const h = harness([pending, { status: 400, body: { error: code } }]);
    await assert.rejects(pollDeviceLogin(h.options), (error: unknown) => error instanceof LoginError && error.code === code);
  }
});

test("an unknown error or a network failure stops", async () => {
  const unknown = harness([{ status: 500, body: { error: "boom" } }]);
  await assert.rejects(pollDeviceLogin(unknown.options), (error: unknown) => error instanceof LoginError && error.code === "unexpected" && /boom/.test(error.message));
  const offline = harness([new Error("offline")]);
  await assert.rejects(pollDeviceLogin(offline.options), (error: unknown) => error instanceof LoginError && error.code === "unexpected");
});

test("gives up once the code's lifetime has passed", async () => {
  const h = harness(Array.from({ length: 50 }, () => pending));
  h.options.expiresInSeconds = 12;
  await assert.rejects(pollDeviceLogin(h.options), (error: unknown) => error instanceof LoginError && error.code === "timeout");
  assert.deepEqual(h.sleeps, [5000, 5000, 5000]);
});

test("startDeviceLogin posts an empty body and normalizes the response", async () => {
  const posts: Array<{ path: string; body: unknown }> = [];
  const start = await startDeviceLogin(async (path, body) => {
    posts.push({ path, body });
    return { status: 200, body: { device_code: "d", user_code: "ABCD-EFGH", verification_uri: "https://stormgtm.com/cli", verification_uri_complete: "https://stormgtm.com/cli?code=ABCD-EFGH", expires_in: 600, interval: 5 } };
  });
  assert.deepEqual(posts, [{ path: "/api/cli/device", body: {} }]);
  assert.equal(start.verification_uri_complete, "https://stormgtm.com/cli?code=ABCD-EFGH");
  assert.equal(start.interval, 5);
  await assert.rejects(startDeviceLogin(async () => ({ status: 500, body: null })), (error: unknown) => error instanceof LoginError && error.code === "start_failed");
  await assert.rejects(startDeviceLogin(async () => { throw new Error("down"); }), (error: unknown) => error instanceof LoginError && error.code === "start_failed");
});

test("makePost sends json and parses replies", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const post = makePost("https://api.test/", (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
  }) as typeof fetch);
  const reply = await post("/api/cli/device/token", { device_code: "d" });
  assert.deepEqual(reply, { status: 400, body: { error: "authorization_pending" } });
  assert.equal(calls[0]!.url, "https://api.test/api/cli/device/token");
  assert.equal(calls[0]!.init.body, JSON.stringify({ device_code: "d" }));
});

test("browser login falls back to API-key login when the device endpoint is missing", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.STORMGTM_API_URL;
  let requestedUrl = "";
  let fallbackCalled = false;
  process.env.STORMGTM_API_URL = "https://api.test";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
  try {
    await loginWithBrowser(async () => {
      fallbackCalled = true;
    });
    assert.equal(requestedUrl, "https://api.test/api/cli/device");
    assert.equal(fallbackCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.STORMGTM_API_URL;
    else process.env.STORMGTM_API_URL = originalApiUrl;
  }
});

test("opens the browser with the platform opener", () => {
  assert.deepEqual(browserCommand("darwin", "https://x.test"), { command: "open", args: ["https://x.test"] });
  assert.deepEqual(browserCommand("linux", "https://x.test"), { command: "xdg-open", args: ["https://x.test"] });
  const url = "https://x.test/cli?code=A&next=B|calc.exe";
  assert.deepEqual(browserCommand("win32", url), { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] });
});
