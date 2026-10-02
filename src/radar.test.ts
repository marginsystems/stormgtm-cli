import { test } from "node:test";
import assert from "node:assert/strict";
import { main, USAGE } from "./cli.js";
import { leadLine, LEADS_USAGE, QUALIFY_LEADS_USAGE, RADAR_USAGE } from "./commands/radar.js";
import { describeError, EXIT, StormGTM, StormGTMError, type RadarEvent, type RadarLead } from "./index.js";

function radarLead(overrides: Partial<RadarLead> = {}): RadarLead {
  return {
    id: "rld_1",
    chatId: "rch_1",
    email: "jane@acme.io",
    name: "Jane Doe",
    title: "CTO",
    company: "Acme",
    companyHost: "acme.io",
    sourceUrl: "https://acme.io/team",
    note: null,
    verdict: null,
    checkId: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

function streamResponse(events: RadarEvent[], chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function scriptedRun(leads: RadarLead[], answer: string): RadarEvent[] {
  const message = (role: "user" | "assistant", content: string) => ({ id: `msg_${role}`, role, content, metadata: null, createdAt: "2026-10-02T00:00:00.000Z" });
  return [
    { type: "user_message", message: message("user", "acme.io") },
    { type: "chat_renamed", name: "acme.io" },
    { type: "status", stage: "thinking" },
    { type: "tool", phase: "start", name: "read_site", summary: "Reading acme.io", callId: "c1" },
    { type: "ping" },
    { type: "tool", phase: "result", name: "read_site", summary: "3 pages, 2 emails", callId: "c1" },
    { type: "tool", phase: "start", name: "read_page", summary: "Reading acme.io/blog", callId: "c2" },
    { type: "tool", phase: "result", name: "read_page", summary: "Could not load", callId: "c2", isError: true },
    ...(leads.length ? [{ type: "leads", leads } as RadarEvent] : []),
    { type: "delta", text: answer },
    { type: "assistant_message", message: message("assistant", answer) },
    { type: "done" },
  ];
}

interface RadarFetchCall {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function radarFetch(stream: (call: RadarFetchCall) => Response) {
  const calls: RadarFetchCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    if (call.url.endsWith("/v1/radar/chats") && call.method === "POST") {
      return new Response(JSON.stringify({ chat: { id: "rch_new", name: "New search", createdAt: "x", updatedAt: "x" } }), { status: 201 });
    }
    return stream(call);
  }) as typeof fetch;
  return { impl, calls };
}

function client(stream: (call: RadarFetchCall) => Response) {
  const fake = radarFetch(stream);
  return { client: new StormGTM({ apiKey: "sgtm_live_test", baseUrl: "https://api.test", fetch: fake.impl }), calls: fake.calls };
}

test("findLeads creates a chat, streams events in order and collects leads and the answer", async () => {
  const leads = [radarLead(), radarLead({ id: "rld_2", email: "sam@acme.io", name: "Sam", title: null })];
  const script = scriptedRun(leads, "Found 2 people at Acme.");
  const { client: api, calls } = client(() => streamResponse(script, 5));
  const seen: RadarEvent[] = [];
  const result = await api.findLeads({ content: "acme.io", onEvent: (event) => seen.push(event) });
  assert.deepEqual(seen, script);
  assert.deepEqual(result, { chatId: "rch_new", answer: "Found 2 people at Acme.", leads });
  assert.equal(calls[0]!.url, "https://api.test/v1/radar/chats");
  assert.equal(calls[1]!.url, "https://api.test/v1/radar/chats/rch_new/message");
  assert.equal(calls[1]!.method, "POST");
  assert.deepEqual(calls[1]!.body, { content: "acme.io" });
  assert.equal(calls[1]!.headers.accept, "text/event-stream");
});

test("findLeads reuses a given chat and merges leads from several events", async () => {
  const first = radarLead();
  const second = radarLead({ id: "rld_2", email: "sam@acme.io" });
  const events: RadarEvent[] = [
    { type: "leads", leads: [first] },
    { type: "leads", leads: [second] },
    { type: "assistant_message", message: { id: "m", role: "assistant", content: "Two.", metadata: null, createdAt: "x" } },
    { type: "done" },
  ];
  const { client: api, calls } = client(() => streamResponse(events, 3));
  const result = await api.findLeads({ content: "dev tools founders", chatId: "rch_9" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.test/v1/radar/chats/rch_9/message");
  assert.deepEqual(result, { chatId: "rch_9", answer: "Two.", leads: [first, second] });
});

test("findLeads throws on an error event", async () => {
  const events: RadarEvent[] = [
    { type: "status", stage: "thinking" },
    { type: "error", message: "Something went wrong while searching. Try again.", kind: "run_failed" },
  ];
  const { client: api } = client(() => streamResponse(events));
  await assert.rejects(api.findLeads({ content: "acme.io", chatId: "rch_1" }), (error: unknown) => error instanceof StormGTMError && error.code === "run_failed" && /went wrong/.test(error.message));
});

test("findLeads throws StormGTMError for a JSON error before streaming", async () => {
  const { client: api } = client(() => new Response(JSON.stringify({ error: { code: "insufficient_credits", message: "Finding leads needs credits; balance is 0" } }), { status: 402 }));
  await assert.rejects(api.findLeads({ content: "acme.io", chatId: "rch_1" }), (error: unknown) => {
    assert.ok(error instanceof StormGTMError);
    assert.equal(error.status, 402);
    assert.equal(error.code, "insufficient_credits");
    assert.equal(describeError(error).exitCode, EXIT.credits);
    return true;
  });
});

test("findLeads throws when the stream ends before the run finishes", async () => {
  const { client: api } = client(() => streamResponse([{ type: "leads", leads: [radarLead()] }]));
  await assert.rejects(api.findLeads({ content: "acme.io", chatId: "rch_1" }), (error: unknown) => error instanceof StormGTMError && error.code === "stream_incomplete");
});

test("radar list, qualify, delete and cancel hit the Radar routes", async () => {
  const { client: api, calls } = client((call) => {
    if (call.url.includes("/leads/qualify")) return new Response(JSON.stringify({ leads: [radarLead({ verdict: "deliverable", checkId: "chk_1" })], remaining: 0 }));
    if (call.url.includes("/v1/radar/leads?")) return new Response(JSON.stringify({ leads: [radarLead()] }));
    if (call.url.endsWith("/v1/radar/chats")) return new Response(JSON.stringify({ chats: [] }));
    if (call.url.endsWith("/messages")) return new Response(JSON.stringify({ chat: {}, messages: [] }));
    return new Response(JSON.stringify({ ok: true }));
  });
  assert.deepEqual(await api.radarChats(), []);
  assert.equal((await api.radarLeads({ chatId: "rch_1" }))[0]!.email, "jane@acme.io");
  assert.equal((await api.qualifyRadarLeads(["rld_1"], "deep")).leads[0]!.verdict, "deliverable");
  await api.radarMessages("rch_1");
  await api.deleteRadarLead("rld_1");
  await api.cancelRadarChat("rch_1");
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.replace("https://api.test", "")}`),
    ["GET /v1/radar/chats", "GET /v1/radar/leads?chatId=rch_1", "POST /v1/radar/leads/qualify", "GET /v1/radar/chats/rch_1/messages", "DELETE /v1/radar/leads/rld_1", "POST /v1/radar/chats/rch_1/cancel"],
  );
  assert.deepEqual(calls[2]!.body, { ids: ["rld_1"], tier: "deep" });
});

test("createRadarChat sends a name only when given", async () => {
  const { client: api, calls } = client(() => new Response("{}"));
  assert.equal((await api.createRadarChat()).id, "rch_new");
  await api.createRadarChat("Acme CTOs");
  assert.deepEqual(calls.map((call) => call.body), [{}, { name: "Acme CTOs" }]);
});

test("help lists the Radar commands under their own group", () => {
  const group = USAGE.slice(USAGE.indexOf("Radar (beta)"), USAGE.indexOf("Sending (beta)"));
  for (const usage of [RADAR_USAGE, LEADS_USAGE, QUALIFY_LEADS_USAGE]) assert.ok(group.includes(usage), usage);
});

test("leadLine skips missing details", () => {
  assert.equal(leadLine(radarLead()), "jane@acme.io  Jane Doe · CTO · Acme");
  assert.equal(leadLine(radarLead({ name: null, title: null, company: "Acme" })), "jane@acme.io  Acme");
  assert.equal(leadLine(radarLead({ name: null, title: null, company: null })), "jane@acme.io");
});

async function runCli(argv: string[], stream: (call: RadarFetchCall) => Response) {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const originalKey = process.env.STORMGTM_API_KEY;
  const originalUrl = process.env.STORMGTM_API_URL;
  const fake = radarFetch(stream);
  const stdout: string[] = [];
  const stderr: string[] = [];
  process.env.STORMGTM_API_KEY = "sgtm_live_test";
  process.env.STORMGTM_API_URL = "https://api.test";
  globalThis.fetch = fake.impl;
  console.log = (...parts: unknown[]) => stdout.push(parts.join(" "));
  console.error = (...parts: unknown[]) => stderr.push(parts.join(" "));
  try {
    const code = await main(argv);
    return { code, calls: fake.calls, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    if (originalKey === undefined) delete process.env.STORMGTM_API_KEY;
    else process.env.STORMGTM_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.STORMGTM_API_URL;
    else process.env.STORMGTM_API_URL = originalUrl;
  }
}

test("stormgtm radar prints progress to stderr, leads and the answer to stdout, and exits 0", async () => {
  const run = await runCli(["radar", "find", "CTOs", "at", "acme.io"], () => streamResponse(scriptedRun([radarLead()], "One CTO.")));
  assert.equal(run.code, EXIT.ok);
  assert.deepEqual(run.calls[1]!.body, { content: "find CTOs at acme.io" });
  assert.match(run.stderr, /^· Reading acme\.io$/m);
  assert.match(run.stderr, /^ {2}Could not load$/m);
  assert.doesNotMatch(run.stderr, /3 pages, 2 emails/);
  assert.match(run.stdout, /^jane@acme\.io {2}Jane Doe · CTO · Acme$/m);
  assert.match(run.stdout, /One CTO\.$/);
  assert.doesNotMatch(run.stdout, /Reading/);
});

test("stormgtm radar exits 2 when nobody was found", async () => {
  const run = await runCli(["radar", "acme.io", "--chat", "rch_1"], () => streamResponse(scriptedRun([], "Nobody with a public email.")));
  assert.equal(run.code, EXIT.rejected);
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0]!.url, "https://api.test/v1/radar/chats/rch_1/message");
});

test("stormgtm radar --json prints only the final result", async () => {
  const run = await runCli(["radar", "acme.io", "--json"], () => streamResponse(scriptedRun([radarLead()], "One CTO.")));
  assert.equal(run.code, EXIT.ok);
  assert.deepEqual(JSON.parse(run.stdout), { chatId: "rch_new", answer: "One CTO.", leads: [radarLead()] });
  assert.equal(run.stderr, "");
});

test("stormgtm radar maps 402 to the credits exit code", async () => {
  const error = await runCli(["radar", "acme.io"], () => new Response(JSON.stringify({ error: { code: "insufficient_credits", message: "balance is 0" } }), { status: 402 })).catch((caught: unknown) => caught);
  assert.equal(describeError(error).exitCode, EXIT.credits);
});

test("stormgtm radar without a request is a usage error", async () => {
  for (const argv of [["radar"], ["radar", "--json"], ["radar", "acme.io", "--chat"]]) {
    const error = await runCli(argv, () => new Response("{}")).catch((caught: unknown) => caught);
    assert.equal(describeError(error).exitCode, EXIT.usage, argv.join(" "));
  }
});

test("stormgtm leads and qualify-leads list and check saved leads", async () => {
  const listed = await runCli(["leads", "--chat", "rch_1"], () => new Response(JSON.stringify({ leads: [radarLead({ verdict: "risky" })] })));
  assert.equal(listed.code, EXIT.ok);
  assert.equal(listed.calls[0]!.url, "https://api.test/v1/radar/leads?chatId=rch_1");
  assert.equal(listed.stdout, "rld_1  jane@acme.io  Jane Doe · CTO · Acme  [risky]");

  const qualified = await runCli(["qualify-leads", "rld_1", "rld_2", "--deep"], () => new Response(JSON.stringify({ leads: [radarLead({ verdict: "deliverable" })], remaining: 1 })));
  assert.equal(qualified.code, EXIT.ok);
  assert.deepEqual(qualified.calls[0]!.body, { ids: ["rld_1", "rld_2"], tier: "deep" });
  assert.equal(qualified.stdout, "jane@acme.io: deliverable");
  assert.match(qualified.stderr, /1 lead not checked yet/);

  const usage = await runCli(["qualify-leads"], () => new Response("{}")).catch((caught: unknown) => caught);
  assert.equal(describeError(usage).exitCode, EXIT.usage);
});
