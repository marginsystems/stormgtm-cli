import { test } from "node:test";
import assert from "node:assert/strict";
import { main, parseCsv } from "./cli.js";
import { clientFromEnv, MissingApiKeyError, StormGTM, StormGTMError, summarize } from "./index.js";

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const { status, body } = handler(String(url), init ?? {});
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

test("sends bearer auth and json body", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 200, body: { verdict: "deliverable" } }));
  const client = new StormGTM({ apiKey: "sgtm_live_x", baseUrl: "https://api.test/", fetch: impl });
  await client.check({ email: "jane@acme.io", tier: "deep" });
  assert.equal(calls[0]!.url, "https://api.test/v1/check");
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, "Bearer sgtm_live_x");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { email: "jane@acme.io", tier: "deep" });
});

test("maps api errors to StormGTMError", async () => {
  const { impl } = fakeFetch(() => ({ status: 402, body: { error: { code: "insufficient_credits", message: "balance is 0" } } }));
  const client = new StormGTM({ apiKey: "k", fetch: impl });
  await assert.rejects(client.me(), (error: unknown) => error instanceof StormGTMError && error.status === 402 && error.code === "insufficient_credits");
});

test("waitForBatch polls until completed", async () => {
  let polls = 0;
  const { impl } = fakeFetch(() => {
    polls++;
    return { status: 200, body: { id: "bat_1", status: polls < 3 ? "running" : "completed", results: [] } };
  });
  const status = await new StormGTM({ apiKey: "k", fetch: impl }).waitForBatch("bat_1", { pollMs: 1 });
  assert.equal(status.status, "completed");
  assert.equal(polls, 3);
});

test("clientFromEnv requires a key", () => {
  assert.throws(() => clientFromEnv({}, undefined, {}), (error: unknown) => error instanceof MissingApiKeyError && /STORMGTM_API_KEY/.test(error.message));
  assert.ok(clientFromEnv({ STORMGTM_API_KEY: "sgtm_live_x" }) instanceof StormGTM);
});

test("summarize puts fatal reasons first", () => {
  const text = summarize({
    email: "noreply@acme.io",
    verdict: "undeliverable",
    score: 0,
    policy: { allowed: false, violations: [] },
    reasons: [
      { code: "mx_found", impact: "positive", weight: 10, detail: "mx" },
      { code: "no_reply", impact: "fatal", weight: -100, detail: "automated sender" },
    ],
  });
  assert.equal(text.split("\n")[0], "noreply@acme.io: undeliverable (0/100) — blocked by policy");
  assert.match(text.split("\n")[1]!, /fatal no_reply/);
});

test("csv parsing keeps known context columns", () => {
  assert.deepEqual(parseCsv("email,name,githubLogin,ignored\njane@acme.io,Jane Doe,janedoe,x\n,no email,,\n"), [
    { email: "jane@acme.io", context: { name: "Jane Doe", githubLogin: "janedoe" } },
  ]);
  assert.deepEqual(parseCsv("a@b.co\nc@d.co"), [{ email: "a@b.co" }, { email: "c@d.co" }]);
});

test("send posts one message as-is and many under messages", async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 202, body: { accepted: [{ id: "em_1", status: "queued" }], rejected: [] } }));
  const client = new StormGTM({ apiKey: "k", baseUrl: "https://api.test", fetch: impl });
  const one = { from: "Ada <ada@mail.acme.io>", to: "jane@acme.io", subject: "Hi", text: "Hello" };
  await client.send(one);
  await client.send([one, { ...one, to: "bob@acme.io" }]);
  assert.equal(calls[0]!.url, "https://api.test/v1/send/emails");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), one);
  assert.equal(JSON.parse(String(calls[1]!.init.body)).messages.length, 2);
});

test("a fully rejected send returns the rejections instead of throwing", async () => {
  const { impl } = fakeFetch(() => ({ status: 422, body: { accepted: [], rejected: [{ index: 0, code: "suppressed", message: "This address bounced" }] } }));
  const result = await new StormGTM({ apiKey: "k", fetch: impl }).send({ from: "ada@mail.acme.io", to: "gone@acme.io", subject: "Hi", text: "x" });
  assert.deepEqual(result.rejected.map((entry) => entry.code), ["suppressed"]);
});

test("domain and settings calls use the send routes", async () => {
  const { impl, calls } = fakeFetch((url) => ({ status: 200, body: url.endsWith("/domains") ? { domains: [] } : url.endsWith("/settings") ? { sendWindow: null } : {} }));
  const client = new StormGTM({ apiKey: "k", baseUrl: "https://api.test", fetch: impl });
  await client.domains();
  await client.domainHealth("d/1");
  await client.resumeDomain("d_1");
  await client.setSendWindow({ startHour: 9, endHour: 17, timezone: "Europe/Berlin" });
  assert.deepEqual(
    calls.map((call) => `${call.init.method} ${call.url}`),
    ["GET https://api.test/v1/send/domains", "GET https://api.test/v1/send/domains/d%2F1/health", "POST https://api.test/v1/send/domains/d_1/resume", "PUT https://api.test/v1/send/settings"],
  );
  assert.deepEqual(JSON.parse(String(calls[3]!.init.body)), { sendWindow: { startHour: 9, endHour: 17, timezone: "Europe/Berlin" } });
});

test("sequence calls use the sequence routes and enrollment rejections do not throw", async () => {
  const { impl, calls } = fakeFetch((url) =>
    url.endsWith("/enrollments") ? { status: 422, body: { accepted: [], rejected: [{ index: 0, code: "missing_variables", message: "Missing firstName" }], maxCredits: 0 } } : { status: 200, body: { id: "seq_1", sequences: [], enrollments: [] } },
  );
  const client = new StormGTM({ apiKey: "k", baseUrl: "https://api.test", fetch: impl });
  await client.createSequence({ name: "Intro", from: "ada@mail.acme.io", steps: [{ delayHours: 0, subject: "Hi", text: "Hello" }] });
  const result = await client.enroll("seq_1", [{ email: "jane@acme.io" }]);
  await client.stopEnrollment("seq_1", "enr/1");
  assert.equal(result.rejected[0]?.code, "missing_variables");
  assert.deepEqual(
    calls.map((call) => `${call.init.method} ${call.url}`),
    ["POST https://api.test/v1/send/sequences", "POST https://api.test/v1/send/sequences/seq_1/enrollments", "POST https://api.test/v1/send/sequences/seq_1/enrollments/enr%2F1/stop"],
  );
});

test("parseEnrollCsv maps extra columns to variables and accepts plain lists", async () => {
  const { parseEnrollCsv } = await import("./cli.js");
  assert.deepEqual(parseEnrollCsv("email,firstName,company\njane@acme.io,Jane,Acme\nbob@acme.io,,Acme\n"), [
    { email: "jane@acme.io", variables: { firstName: "Jane", company: "Acme" } },
    { email: "bob@acme.io", variables: { company: "Acme" } },
  ]);
  assert.deepEqual(parseEnrollCsv("jane@acme.io\nbob@acme.io"), [{ email: "jane@acme.io" }, { email: "bob@acme.io" }]);
});

test("parseEnrollCsv requires an email column in CSV headers and recognizes email aliases", async () => {
  const { parseEnrollCsv } = await import("./cli.js");
  assert.throws(() => parseEnrollCsv("full_name,address\nJane,jane@acme.io"), /must include an email column/);
  assert.deepEqual(parseEnrollCsv("\uFEFFemail,name\njane@acme.io,Jane"), [{ email: "jane@acme.io", variables: { name: "Jane" } }]);
  assert.deepEqual(parseEnrollCsv("\uFEFFname,work_email\nJane,jane@acme.io"), [{ email: "jane@acme.io", variables: { name: "Jane" } }]);
});

test("CSV parsers preserve commas inside quoted fields", async () => {
  const { parseEnrollCsv } = await import("./cli.js");
  assert.deepEqual(parseEnrollCsv('email,name,company\njane@acme.io,"Doe, Jane","Acme, Inc."'), [
    { email: "jane@acme.io", variables: { name: "Doe, Jane", company: "Acme, Inc." } },
  ]);
  assert.deepEqual(parseCsv('email,name\njane@acme.io,"Doe, Jane"'), [{ email: "jane@acme.io", context: { name: "Doe, Jane" } }]);
  assert.deepEqual(parseEnrollCsv('email, firstName\njane@acme.io, "Jane"'), [{ email: "jane@acme.io", variables: { firstName: "Jane" } }]);
  assert.deepEqual(parseCsv('email, name\njane@acme.io, "Jane Doe"'), [{ email: "jane@acme.io", context: { name: "Jane Doe" } }]);
});

test("sequence CLI requests the API enrollment limit", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.STORMGTM_API_KEY;
  const originalApiUrl = process.env.STORMGTM_API_URL;
  const requests: string[] = [];
  process.env.STORMGTM_API_KEY = "test-key";
  process.env.STORMGTM_API_URL = "https://api.test";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    const body = url.endsWith("/enrollments?limit=500")
      ? { enrollments: [] }
      : { id: "seq_1", name: "Intro", from: "ada@mail.acme.io", variables: [], steps: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await main(["sequence", "seq_1"]), 0);
    assert.ok(requests.includes("https://api.test/v1/send/sequences/seq_1/enrollments?limit=500"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.STORMGTM_API_KEY;
    else process.env.STORMGTM_API_KEY = originalApiKey;
    if (originalApiUrl === undefined) delete process.env.STORMGTM_API_URL;
    else process.env.STORMGTM_API_URL = originalApiUrl;
  }
});
