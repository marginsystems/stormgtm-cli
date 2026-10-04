import { test } from "node:test";
import assert from "node:assert/strict";
import { main, USAGE } from "./cli.js";
import { ADD_LEADS_USAGE, cmdAddLeads, cmdLeads, csvCell, leadLine, leadsCsv, LEADS_USAGE, QUALIFY_LEADS_USAGE, RADAR_USAGE, type RadarIo } from "./commands/radar.js";
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
    origin: "web",
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
  const group = USAGE.slice(USAGE.indexOf("Radar (beta)"), USAGE.indexOf("Sending (from your connected mailboxes)"));
  for (const usage of [RADAR_USAGE, LEADS_USAGE, QUALIFY_LEADS_USAGE, ADD_LEADS_USAGE]) assert.ok(group.includes(usage), usage);
  assert.doesNotMatch(USAGE, /leadsforge/i);
  assert.match(group, /pass nextAfter until no leads return/);
  assert.doesNotMatch(group, /takes every lead/);
});

test("help says sends go out from connected mailboxes", () => {
  const group = USAGE.slice(USAGE.indexOf("Sending (from your connected mailboxes)"), USAGE.indexOf("Inbox (beta)"));
  assert.match(group, /Emails go out from the mailboxes you connected/);
  assert.match(group, /stormgtm send \(--mailbox <mailbox-id> \| --from <mailbox address>\)/);
  assert.doesNotMatch(USAGE, /coming soon|Resend/);
  assert.match(USAGE, /stormgtm mailbox-domains/);
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

function capture(): RadarIo & { lines: string[]; progressLines: string[] } {
  const lines: string[] = [];
  const progressLines: string[] = [];
  return { lines, progressLines, out: (line) => void lines.push(line), progress: (line) => void progressLines.push(line) };
}

test("add-leads sends emails or CSV rows, reports skips, and accepts a 422 with rejections", async () => {
  const { client: api, calls } = client((call) => {
    const leads = (call.body as { leads: Array<{ email: string }> }).leads;
    if (leads.every((lead) => !lead.email.includes("@"))) return new Response(JSON.stringify({ leads: [], duplicates: [], rejected: [{ index: 0, code: "invalid_email", message: "Not a valid email address" }] }), { status: 422 });
    return new Response(JSON.stringify({ leads: [radarLead({ origin: "manual" })], duplicates: ["bo@acme.io"], rejected: [{ index: 2, code: "invalid_email", message: "Not a valid email address" }] }), { status: 201 });
  });
  const io = capture();
  assert.equal(await cmdAddLeads(["jane@acme.io", "bo@acme.io", "nope"], () => api, () => [], io), EXIT.ok);
  assert.deepEqual(calls[0]!.body, { leads: [{ email: "jane@acme.io" }, { email: "bo@acme.io" }, { email: "nope" }] });
  assert.deepEqual(io.lines, ["rld_1  jane@acme.io  Jane Doe · CTO · Acme"]);
  assert.deepEqual(io.progressLines, ["Skipped nope: Not a valid email address", "1 already in your leads", "1 lead added, free. Qualify them with: stormgtm qualify-leads <lead-id...>"]);

  const read: string[] = [];
  await cmdAddLeads(["leads.csv", "--json"], () => api, (file) => (read.push(file), [{ email: "jane@acme.io", name: "Jane Doe", company: "Acme" }]), capture());
  assert.deepEqual(read, ["leads.csv"]);
  assert.deepEqual(calls[1]!.body, { leads: [{ email: "jane@acme.io", name: "Jane Doe", company: "Acme" }] });

  assert.equal(await cmdAddLeads(["nope"], () => api, () => [], capture()), EXIT.rejected);
  await assert.rejects(cmdAddLeads([], () => api, () => [], capture()), /add-leads/);
  await assert.rejects(cmdAddLeads(["empty.csv"], () => api, () => [], capture()), /No leads in empty\.csv/);
});

test("leads marks the ones the user added, and leads saved from Leadsforge before it was removed still list", async () => {
  const { client: api } = client(() => new Response(JSON.stringify({ leads: [radarLead(), radarLead({ id: "rld_2", email: "cto@initech.io", origin: "leadsforge", name: null, title: null, company: null }), radarLead({ id: "rld_3", email: "me@acme.io", origin: "manual", name: null, title: null, company: null })] })));
  const io = capture();
  await cmdLeads([], () => api, io);
  assert.deepEqual(io.lines, ["rld_1  jane@acme.io  Jane Doe · CTO · Acme", "rld_2  cto@initech.io", "rld_3  me@acme.io  (added)"]);
});

test("leads --after takes only new leads and prints the cursor for next time", async () => {
  const { client: api, calls } = client((call) =>
    new Response(JSON.stringify(call.url.includes("after=0") ? { leads: [radarLead(), radarLead({ id: "rld_2", email: "bo@acme.io", verdict: "deliverable" })], nextAfter: "2.rld_2" } : { leads: [], nextAfter: "2.rld_2" })),
  );
  const io = capture();
  assert.equal(await cmdLeads(["--after", "0", "--limit", "50", "--chat", "rch_1"], () => api, io), EXIT.ok);
  assert.equal(calls[0]!.url, "https://api.test/v1/radar/leads?after=0&chatId=rch_1&limit=50");
  assert.deepEqual(io.lines, ["rld_1  jane@acme.io  Jane Doe · CTO · Acme", "rld_2  bo@acme.io  Jane Doe · CTO · Acme  [deliverable]"]);
  assert.deepEqual(io.progressLines, ["2 new leads.", "Next time: stormgtm leads --after 2.rld_2"]);

  const idle = capture();
  await cmdLeads(["--after", "2.rld_2"], () => api, idle);
  assert.deepEqual(idle.lines, []);
  assert.deepEqual(idle.progressLines, ["No new leads.", "Next time: stormgtm leads --after 2.rld_2"]);

  const json = capture();
  await cmdLeads(["--after", "2.rld_2", "--json"], () => api, json);
  assert.deepEqual(JSON.parse(json.lines[0]!), { leads: [], nextAfter: "2.rld_2" });

  await assert.rejects(cmdLeads(["--after"], () => api, io), /stormgtm leads/);
  await assert.rejects(cmdLeads(["--limit", "5"], () => api, io), /--limit needs --after/);
  await assert.rejects(cmdLeads(["--after", "0", "--limit", "0"], () => api, io), /--limit needs --after/);
  await assert.rejects(cmdLeads(["--after", "0", "--limit", "abc"], () => api, io), /--limit needs --after/);

  const csv = capture();
  await cmdLeads(["--after", "0", "--csv"], () => api, csv);
  assert.equal(csv.lines[0]!.split("\r\n").length, 3);
  assert.deepEqual(csv.progressLines, ["2 new leads.", "Next time: stormgtm leads --after 2.rld_2"]);
});

test("leads --csv prints a header row and one row per lead, scoped to the chat", async () => {
  const { client: api, calls } = client(() => new Response(JSON.stringify({ leads: [radarLead({ note: "Runs platform", verdict: "deliverable", createdAt: "2026-10-02T09:30:00.000Z" }), radarLead({ id: "rld_2", email: "bo@gmail.com", name: null, title: null, company: null, companyHost: null, sourceUrl: "", createdAt: "" })] })));
  const io = capture();
  assert.equal(await cmdLeads(["--csv", "--chat", "rch_1"], () => api, io), EXIT.ok);
  assert.deepEqual(io.lines, [
    "name,email,title,company,company site,source URL,note,verdict,found date\r\n" +
      "Jane Doe,jane@acme.io,CTO,Acme,acme.io,https://acme.io/team,Runs platform,deliverable,2026-10-02\r\n" +
      ",bo@gmail.com,,,,,,not checked,",
  ]);
  assert.equal(calls[0]!.url, "https://api.test/v1/radar/leads?chatId=rch_1");
  assert.equal(calls.length, 1);
});

test("leads --csv prints only the header when there are no leads, and refuses --json with it", async () => {
  const { client: api } = client(() => new Response(JSON.stringify({ leads: [] })));
  const io = capture();
  await cmdLeads(["--csv"], () => api, io);
  assert.deepEqual(io.lines, ["name,email,title,company,company site,source URL,note,verdict,found date"]);
  await assert.rejects(cmdLeads(["--csv", "--json"], () => api, io), /--json \| --csv/);
});

test("CSV cells quote commas, quotes, newlines and edge spaces, and keep non-ASCII text", () => {
  assert.equal(csvCell("Acme, Inc."), '"Acme, Inc."');
  assert.equal(csvCell('Jane "JD" Doe'), '"Jane ""JD"" Doe"');
  assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
  assert.equal(csvCell("line one\r\nline two"), '"line one\r\nline two"');
  assert.equal(csvCell(" padded "), '" padded "');
  assert.equal(csvCell("Zoë Müller 北京"), "Zoë Müller 北京");
  assert.equal(csvCell(null), "");
  const csv = leadsCsv([radarLead({ name: "Søren Åberg", company: "Müller, GmbH", note: 'Said "call me"\nnext week', createdAt: "" })]);
  assert.equal(csv.split("\r\n")[1], 'Søren Åberg,jane@acme.io,CTO,"Müller, GmbH",acme.io,https://acme.io/team,"Said ""call me""\nnext week",not checked,');
});

test("CSV cells that a spreadsheet would run as a formula are neutralised", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://evil.test\")"), '"\'=HYPERLINK(""http://evil.test"")"');
  assert.equal(csvCell("+1 555 0100"), "'+1 555 0100");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\t=1+1"), "'\t=1+1");
  assert.equal(csvCell("\r=1+1"), "\"'\r=1+1\"");
  assert.equal(csvCell("a=b"), "a=b");
  assert.equal(csvCell("jane@acme.io"), "jane@acme.io");
});

test("the leadsforge command is gone", async () => {
  await assert.rejects(main(["leadsforge"]), /Unknown command/i);
});
