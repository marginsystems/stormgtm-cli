import { test } from "node:test";
import assert from "node:assert/strict";
import { mailboxDomainLine, mailboxLine, main } from "./cli.js";
import { StormGTM, StormGTMError, type Mailbox, type MailboxDomain } from "./index.js";

function mailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: "mbx_1",
    address: "ada@acme.io",
    displayName: "Ada",
    domain: "acme.io",
    kind: "smtp",
    status: "active",
    smtp: { host: "smtp.forge.example", port: 465, security: "ssl", username: "ada@acme.io" },
    imap: { host: "imap.forge.example", port: 993, security: "ssl", username: "ada@acme.io" },
    lastTestAt: "2026-10-03T00:00:00.000Z",
    lastError: null,
    pausedAt: null,
    pausedReason: null,
    signature: null,
    caps: { warmupStep: 0, maxStep: 4, dailyCap: 5, dailyCapOverride: null, gapMinutes: 8, sentToday: 0 },
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const { status, body } = handler(String(url), init ?? {});
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

test("mailbox client methods call the mailbox routes", async () => {
  const { impl, calls } = fakeFetch((url) => ({
    status: 200,
    body: url.endsWith("/v1/mailboxes") ? { mailboxes: [mailbox()] } : url.endsWith("/import") ? { connected: 1, failed: 0, results: [] } : mailbox(),
  }));
  const client = new StormGTM({ apiKey: "k", baseUrl: "https://api.test", fetch: impl });
  assert.equal((await client.listMailboxes())[0]?.address, "ada@acme.io");
  await client.connectMailbox({ address: "ada@acme.io", provider: "google", smtp: { password: "app-pass" } });
  await client.importMailboxes("address,smtp_password\nada@acme.io,x", "mailforge");
  await client.testMailbox("mbx/1");
  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.body]),
    [
      ["GET", "https://api.test/v1/mailboxes", undefined],
      ["POST", "https://api.test/v1/mailboxes", { address: "ada@acme.io", provider: "google", smtp: { password: "app-pass" } }],
      ["POST", "https://api.test/v1/mailboxes/import", { csv: "address,smtp_password\nada@acme.io,x", provider: "mailforge" }],
      ["POST", "https://api.test/v1/mailboxes/mbx%2F1/test", undefined],
    ],
  );
});

test("a failed mailbox test surfaces the friendly code", async () => {
  const { impl } = fakeFetch(() => ({ status: 422, body: { error: { code: "mailbox_auth_failed", message: "SMTP sign-in failed" } } }));
  const client = new StormGTM({ apiKey: "k", baseUrl: "https://api.test", fetch: impl });
  await assert.rejects(client.testMailbox("mbx_1"), (error: unknown) => error instanceof StormGTMError && error.code === "mailbox_auth_failed");
});

const waitingDomain: MailboxDomain = {
  domain: "acme.io",
  mailboxes: 2,
  unsubscribeHost: "u.acme.io",
  verified: false,
  verifiedAt: null,
  record: { type: "CNAME", name: "u.acme.io", value: "stormgtm.com" },
};

test("mailbox domain client methods call the domain routes", async () => {
  const { impl, calls } = fakeFetch((url) => ({ status: 200, body: url.endsWith("/v1/mailboxes/domains") ? { domains: [waitingDomain] } : waitingDomain }));
  const client = new StormGTM({ apiKey: "k", baseUrl: "https://api.test", fetch: impl });
  assert.equal((await client.mailboxDomains())[0]?.unsubscribeHost, "u.acme.io");
  await client.setUnsubscribeHost("acme.io", "u.acme.io");
  await client.setUnsubscribeHost("acme.io", null);
  await client.verifyUnsubscribeHost("acme.io");
  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.body]),
    [
      ["GET", "https://api.test/v1/mailboxes/domains", undefined],
      ["PUT", "https://api.test/v1/mailboxes/domains/acme.io/unsubscribe-host", { host: "u.acme.io" }],
      ["PUT", "https://api.test/v1/mailboxes/domains/acme.io/unsubscribe-host", { host: null }],
      ["POST", "https://api.test/v1/mailboxes/domains/acme.io/unsubscribe-host/verify", undefined],
    ],
  );
});

test("sends and sequences can name a mailbox", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 202, body: { accepted: [], rejected: [] } }));
  const client = new StormGTM({ apiKey: "k", baseUrl: "https://api.test", fetch: impl });
  await client.send({ mailboxId: "mbx_1", to: "bob@globex.com", subject: "Hi", text: "Hello" });
  await client.send([{ from: "ada@acme.io", to: "bob@globex.com", subject: "Hi", text: "Hello" }]);
  await client.createSequence({ name: "Intro", mailboxId: "mbx_1", steps: [{ delayHours: 0, subject: "Hi", text: "Hello" }] });
  assert.deepEqual(
    calls.map((call) => call.body),
    [
      { mailboxId: "mbx_1", to: "bob@globex.com", subject: "Hi", text: "Hello" },
      { messages: [{ from: "ada@acme.io", to: "bob@globex.com", subject: "Hi", text: "Hello" }] },
      { name: "Intro", mailboxId: "mbx_1", steps: [{ delayHours: 0, subject: "Hi", text: "Hello" }] },
    ],
  );
});

test("mailboxDomainLine shows the host and its state", () => {
  assert.equal(mailboxDomainLine(waitingDomain), "acme.io  u.acme.io  waiting for DNS");
  assert.equal(mailboxDomainLine({ ...waitingDomain, verified: true }), "acme.io  u.acme.io  verified");
  assert.equal(mailboxDomainLine({ ...waitingDomain, unsubscribeHost: null, record: null }), "acme.io  not set");
});

test("the mailbox-domains command prints one line per domain and send needs a sender", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalKey = process.env.STORMGTM_API_KEY;
  const originalUrl = process.env.STORMGTM_API_URL;
  const stdout: string[] = [];
  process.env.STORMGTM_API_KEY = "sgtm_live_test";
  process.env.STORMGTM_API_URL = "https://api.test";
  globalThis.fetch = fakeFetch(() => ({ status: 200, body: { domains: [waitingDomain] } })).impl;
  console.log = (...parts: unknown[]) => stdout.push(parts.join(" "));
  try {
    assert.equal(await main(["mailbox-domains"]), 0);
    assert.deepEqual(stdout, ["acme.io  u.acme.io  waiting for DNS"]);
    await assert.rejects(main(["send", "--to", "bob@globex.com", "--subject", "Hi", "--text", "Hello"]));
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalKey === undefined) delete process.env.STORMGTM_API_KEY;
    else process.env.STORMGTM_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.STORMGTM_API_URL;
    else process.env.STORMGTM_API_URL = originalUrl;
  }
});

test("mailboxLine says when a new mailbox starts sending", () => {
  const caps = { ...mailbox().caps, dailyCap: 0, week: 1, nextDailyCap: 10, nextStepAt: "2026-10-17T00:00:00.000Z" };
  assert.equal(mailboxLine(mailbox({ caps })), "mbx_1  ada@acme.io  active  starts 2026-10-17 at 10/day");
  assert.equal(mailboxLine(mailbox({ caps: { ...caps, dailyCapOverride: 0 } })), "mbx_1  ada@acme.io  active  0/0 today");
  assert.equal(mailboxLine(mailbox({ status: "paused", caps })), "mbx_1  ada@acme.io  paused  0/0 today");
});

test("mailboxLine shows the warm-up day while a mailbox is warming up", () => {
  const caps = { warmupStep: 0, maxStep: 6, week: 1, dailyCap: 0, dailyCapOverride: null, nextDailyCap: 10, nextStepAt: "2026-10-17T00:00:00.000Z", gapMinutes: 8, sentToday: 0 };
  const warmup = { enabled: true, dailyTarget: 3, day: 4, coldSendsStartAt: "2026-10-17T00:00:00.000Z" };
  assert.equal(mailboxLine(mailbox({ caps, phase: "warming_up", warmup })), "mbx_1  ada@acme.io  active  warming up day 4/14, starts 2026-10-17 at 10/day");
  assert.equal(mailboxLine(mailbox({ phase: "ramping", warmup })), "mbx_1  ada@acme.io  active  0/5 today");
});

test("mailboxLine shows status and today's capacity", () => {
  assert.equal(mailboxLine(mailbox()), "mbx_1  ada@acme.io  active  0/5 today");
  assert.equal(mailboxLine(mailbox({ status: "error", lastError: "mailbox_auth_failed" })), "mbx_1  ada@acme.io  error (mailbox_auth_failed)  0/5 today");
});

test("the mailboxes and mailbox-test commands print one line each", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalKey = process.env.STORMGTM_API_KEY;
  const originalUrl = process.env.STORMGTM_API_URL;
  const stdout: string[] = [];
  process.env.STORMGTM_API_KEY = "sgtm_live_test";
  process.env.STORMGTM_API_URL = "https://api.test";
  globalThis.fetch = fakeFetch((url) => ({ status: 200, body: url.endsWith("/v1/mailboxes") ? { mailboxes: [mailbox()] } : mailbox() })).impl;
  console.log = (...parts: unknown[]) => stdout.push(parts.join(" "));
  try {
    assert.equal(await main(["mailboxes"]), 0);
    assert.equal(await main(["mailbox-test", "mbx_1"]), 0);
    assert.deepEqual(stdout, ["mbx_1  ada@acme.io  active  0/5 today", "ada@acme.io: connection works"]);
    await assert.rejects(main(["mailbox-test"]));
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalKey === undefined) delete process.env.STORMGTM_API_KEY;
    else process.env.STORMGTM_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.STORMGTM_API_URL;
    else process.env.STORMGTM_API_URL = originalUrl;
  }
});
