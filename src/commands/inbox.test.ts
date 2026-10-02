import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../cli.js";
import { CommandError, EXIT } from "../errors.js";
import type { InboxMessage, InboxThread } from "../index.js";
import { formatThread, positionals, threadTable, type InboxIo } from "./inbox.js";

const thread: InboxThread = {
  id: "thr_1",
  subject: "Pricing question",
  counterpart: "jane@acme.io",
  participants: ["jane@acme.io"],
  mailbox: "hello@mail.acme.io",
  messageCount: 2,
  unreadCount: 1,
  unread: true,
  snippet: "Can you send pricing?",
  lastMessageAt: "2026-10-01T09:30:00.000Z",
  archived: false,
  spam: false,
  hasAttachment: false,
};

const message: InboxMessage = {
  id: "msg_1",
  direction: "inbound",
  from: "jane@acme.io",
  fromName: "Jane Doe",
  to: ["hello@mail.acme.io"],
  cc: [],
  replyTo: null,
  subject: "Pricing question",
  text: "Can you send pricing?\n\n> quoted history",
  replyText: "Can you send pricing?",
  hasHtml: false,
  at: "2026-10-01T09:30:00.000Z",
  read: false,
  auth: { spf: "pass", dkim: "fail", dmarc: "fail", verifiedSender: false },
  attachments: [{ id: "att_1", filename: "brief.pdf", contentType: "application/pdf", size: 1200, inline: false, blocked: null, downloadUrl: "https://api.test/media/att_1" }],
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

async function run(argv: string[], io: Partial<InboxIo> = {}, respond: (call: Call) => { status: number; body: unknown } = () => ({ status: 200, body: {} })) {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const originalKey = process.env.STORMGTM_API_KEY;
  const originalUrl = process.env.STORMGTM_API_URL;
  const calls: Call[] = [];
  const out: string[] = [];
  process.env.STORMGTM_API_KEY = "sgtm_live_test";
  process.env.STORMGTM_API_URL = "https://api.test";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const reply = respond(call);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
  console.log = (...parts: unknown[]) => out.push(parts.join(" "));
  console.error = (...parts: unknown[]) => out.push(parts.join(" "));
  const fullIo: InboxIo = { stdinIsTTY: () => false, readStdin: async () => "", confirm: async () => false, ...io };
  try {
    const code = await main(argv, fullIo);
    return { code, calls, out: out.join("\n") };
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

function isUsage(error: unknown): boolean {
  return error instanceof CommandError && error.exitCode === EXIT.usage;
}

test("inbox lists threads with folder, unread and search filters", async () => {
  const { code, calls, out } = await run(["inbox", "--folder", "sent", "--unread", "--search", "pricing"], {}, () => ({ status: 200, body: { threads: [thread], nextCursor: "next_1" } }));
  assert.equal(code, EXIT.ok);
  assert.equal(calls[0]!.url, "https://api.test/v1/inbox/threads?folder=sent&unread=true&q=pricing");
  assert.match(out, /^\* {2}thr_1 {2}2026-10-01 09:30 {2}jane@acme\.io {2}Pricing question \(2\)/);
  assert.match(out, /--cursor next_1/);
});

test("inbox rejects an unknown folder and a missing search query", async () => {
  await assert.rejects(run(["inbox", "--folder", "trash"]), isUsage);
  await assert.rejects(run(["inbox", "--search"]), isUsage);
});

test("thread prints the reply text by default, the full text with --full, and flags unverified senders", async () => {
  const detail = { ...thread, messages: [message] };
  const short = await run(["thread", "thr_1"], {}, () => ({ status: 200, body: detail }));
  assert.equal(short.calls[0]!.url, "https://api.test/v1/inbox/threads/thr_1");
  assert.match(short.out, /From: Jane Doe <jane@acme\.io> \[unverified sender\]/);
  assert.match(short.out, /Attachment: brief\.pdf \(1200 bytes\)/);
  assert.doesNotMatch(short.out, /quoted history/);
  const full = await run(["thread", "--full", "thr_1"], {}, () => ({ status: 200, body: detail }));
  assert.match(full.out, /quoted history/);
  await assert.rejects(run(["thread"]), isUsage);
});

test("reply reads piped stdin and sends without asking", async () => {
  let asked = false;
  const { code, calls, out } = await run(["reply", "thr_1", "--key", "r-1"], { readStdin: async () => "Here is our pricing.\n", confirm: async () => (asked = true) }, () => ({
    status: 202,
    body: { id: "em_1", threadId: "thr_1", status: "queued", duplicate: false, from: "hello@mail.acme.io", to: "jane@acme.io", subject: "Re: Pricing question" },
  }));
  assert.equal(code, EXIT.ok);
  assert.equal(asked, false);
  assert.deepEqual(calls, [{ method: "POST", url: "https://api.test/v1/inbox/threads/thr_1/reply", body: { text: "Here is our pricing.\n", idempotencyKey: "r-1" } }]);
  assert.match(out, /queued em_1 → jane@acme\.io/);
});

test("reply in a terminal confirms first and sends nothing when declined", async () => {
  let question = "";
  const declined = await run(["reply", "thr_1", "--text", "Sure"], { stdinIsTTY: () => true, confirm: async (text) => ((question = text), false) }, () => ({ status: 200, body: { ...thread, messages: [] } }));
  assert.equal(declined.code, EXIT.rejected);
  assert.match(question, /Reply to jane@acme\.io on "Pricing question".*1 credit/);
  assert.deepEqual(declined.calls.map((call) => call.method), ["GET"]);
  const skipped = await run(["reply", "thr_1", "--text", "Sure", "--yes"], { stdinIsTTY: () => true }, () => ({ status: 202, body: { id: "em_1", duplicate: true, to: "jane@acme.io", subject: "Re: x" } }));
  assert.equal(skipped.code, EXIT.ok);
  assert.deepEqual(skipped.calls.map((call) => call.method), ["POST"]);
});

test("reply needs a thread and text", async () => {
  await assert.rejects(run(["reply"]), isUsage);
  await assert.rejects(run(["reply", "thr_1"], { stdinIsTTY: () => true }), isUsage);
  await assert.rejects(run(["reply", "thr_1"], { readStdin: async () => "  \n" }), isUsage);
});

test("read marks threads read or unread", async () => {
  const read = await run(["read", "thr_1", "thr_2"], {}, () => ({ status: 200, body: { updated: 2 } }));
  assert.deepEqual(read.calls[0], { method: "POST", url: "https://api.test/v1/inbox/threads/read", body: { ids: ["thr_1", "thr_2"], read: true } });
  assert.match(read.out, /Marked 2 threads read/);
  const unread = await run(["read", "thr_1", "--unread"], {}, () => ({ status: 200, body: { updated: 1 } }));
  assert.deepEqual(unread.calls[0]!.body, { ids: ["thr_1"], read: false });
  await assert.rejects(run(["read"]), isUsage);
  await assert.rejects(run(["read", "thr_x"], {}, () => ({ status: 200, body: { updated: 0 } })), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.failed);
});

test("archive, spam and unread commands call the matching routes", async () => {
  const updated = () => ({ status: 200, body: { updated: 2 } });
  const cases: Array<[string, string, Record<string, unknown>, RegExp]> = [
    ["archive", "archive", { archived: true }, /2 threads archived/],
    ["unarchive", "archive", { archived: false }, /moved back to the inbox/],
    ["spam", "spam", { spam: true }, /never be emailed again/],
    ["unspam", "spam", { spam: false }, /moved out of spam/],
    ["unread", "read", { read: false }, /marked unread/],
  ];
  for (const [command, route, extra, message] of cases) {
    const result = await run([command, "thr_1", "thr_2"], {}, updated);
    assert.deepEqual(result.calls[0], { method: "POST", url: `https://api.test/v1/inbox/threads/${route}`, body: { ids: ["thr_1", "thr_2"], ...extra } });
    assert.match(result.out, message);
    await assert.rejects(run([command]), isUsage);
  }
  await assert.rejects(run(["spam", "thr_x"], {}, () => ({ status: 200, body: { updated: 0 } })), (error: unknown) => error instanceof CommandError && error.exitCode === EXIT.failed);
});

test("counts prints a line per folder and JSON on request", async () => {
  const counts = { inbox: { total: 5, unread: 2 }, sent: { total: 1, unread: 0 }, archived: { total: 0, unread: 0 }, spam: { total: 3, unread: 3 } };
  const text = await run(["counts"], {}, () => ({ status: 200, body: { counts } }));
  assert.equal(text.calls[0]!.url, "https://api.test/v1/inbox/counts");
  assert.match(text.out, /inbox +5 {2}\(2 unread\)/);
  assert.match(text.out, /spam +3 {2}\(3 unread\)/);
  assert.deepEqual(JSON.parse((await run(["counts", "--json"], {}, () => ({ status: 200, body: { counts } }))).out), counts);
});

test("helpers skip flag values and format empty states", () => {
  assert.deepEqual(positionals(["--text", "hi there", "thr_1", "--yes", "--key", "k"]), ["thr_1"]);
  assert.equal(threadTable([]), "No threads.");
  assert.match(formatThread({ id: "thr_1", subject: "", messages: [{ ...message, text: null, replyText: null, hasHtml: true }] }, false), /HTML only/);
});
