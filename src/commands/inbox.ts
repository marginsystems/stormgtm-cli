import { createInterface } from "node:readline/promises";
import { CommandError, EXIT, usageError } from "../errors.js";
import type { InboxFolder, InboxMessage, InboxThread, StormGTM } from "../index.js";

export const INBOX_USAGE = "stormgtm inbox [--folder inbox|sent|archived] [--unread] [--search <query>] [--cursor <cursor>] [--json]";
export const THREAD_USAGE = "stormgtm thread <thread-id> [--full] [--json]";
export const REPLY_USAGE = "stormgtm reply <thread-id> (--text <text> | < reply.txt) [--key <idempotency-key>] [--yes] [--json]";
export const READ_USAGE = "stormgtm read <thread-id...> [--unread]";

const FOLDERS: InboxFolder[] = ["inbox", "sent", "archived"];
const VALUE_FLAGS = new Set(["--folder", "--search", "--cursor", "--text", "--key"]);

export interface InboxIo {
  stdinIsTTY(): boolean;
  readStdin(): Promise<string>;
  confirm(question: string): Promise<boolean>;
}

export const processIo: InboxIo = {
  stdinIsTTY: () => process.stdin.isTTY === true,
  async readStdin() {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
    return Buffer.concat(chunks).toString("utf8");
  },
  async confirm(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return /^y(es)?$/i.test((await rl.question(question)).trim());
    } finally {
      rl.close();
    }
  },
};

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function positionals(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (VALUE_FLAGS.has(arg)) index++;
    else if (!arg.startsWith("--")) values.push(arg);
  }
  return values;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function threadTable(threads: InboxThread[]): string {
  if (threads.length === 0) return "No threads.";
  const rows = threads.map((thread) => [
    thread.unread ? "*" : " ",
    thread.id,
    thread.lastMessageAt.slice(0, 16).replace("T", " "),
    oneLine(thread.counterpart, 32),
    `${oneLine(thread.subject || "(no subject)", 60)} (${thread.messageCount})`,
  ]);
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) => row.map((cell, column) => (column < row.length - 1 ? cell.padEnd(widths[column]!) : cell)).join("  ")).join("\n");
}

function senderLabel(message: InboxMessage): string {
  const from = message.fromName ? `${message.fromName} <${message.from}>` : message.from;
  return message.direction === "inbound" && message.auth.verifiedSender === false ? `${from} [unverified sender]` : from;
}

export function formatThread(thread: { id: string; subject: string; messages: InboxMessage[] }, full: boolean): string {
  const lines = [`${thread.id}  ${thread.subject || "(no subject)"}  ${thread.messages.length} message${thread.messages.length === 1 ? "" : "s"}`];
  for (const message of thread.messages) {
    lines.push("", `--- ${message.direction === "inbound" ? "received" : "sent"} ${message.at}`, `From: ${senderLabel(message)}`, `To: ${message.to.join(", ")}`);
    const body = full ? (message.text ?? message.replyText) : (message.replyText ?? message.text);
    lines.push("", body?.trim() || (message.hasHtml ? "(HTML only; open it in the dashboard)" : "(empty)"));
    for (const attachment of message.attachments) lines.push(`Attachment: ${attachment.filename} (${attachment.size} bytes)${attachment.blocked ? `, blocked: ${attachment.blocked}` : ""}`);
  }
  return lines.join("\n");
}

export async function cmdInbox(args: string[], client: () => StormGTM): Promise<number> {
  const folder = flag(args, "folder") ?? "inbox";
  if (!FOLDERS.includes(folder as InboxFolder)) throw usageError(INBOX_USAGE);
  const search = flag(args, "search");
  if (has(args, "search") && (!search || search.startsWith("--"))) throw usageError(INBOX_USAGE);
  const page = await client().threads({ folder: folder as InboxFolder, unread: has(args, "unread") ? true : undefined, q: search, cursor: flag(args, "cursor") });
  if (has(args, "json")) console.log(JSON.stringify(page, null, 2));
  else {
    console.log(threadTable(page.threads));
    if (page.nextCursor) console.log(`More: stormgtm inbox --folder ${folder} --cursor ${page.nextCursor}`);
  }
  return EXIT.ok;
}

export async function cmdThread(args: string[], client: () => StormGTM): Promise<number> {
  const [id] = positionals(args);
  if (!id) throw usageError(THREAD_USAGE);
  const thread = await client().thread(id);
  console.log(has(args, "json") ? JSON.stringify(thread, null, 2) : formatThread(thread, has(args, "full")));
  return EXIT.ok;
}

export async function cmdReply(args: string[], client: () => StormGTM, io: InboxIo = processIo): Promise<number> {
  const [threadId] = positionals(args);
  if (!threadId) throw usageError(REPLY_USAGE);
  const interactive = io.stdinIsTTY();
  let text = flag(args, "text");
  if (text === undefined) {
    if (interactive) throw usageError(REPLY_USAGE);
    text = await io.readStdin();
  }
  if (!text.trim()) throw usageError(REPLY_USAGE);
  if (interactive && !has(args, "yes")) {
    const thread = await client().thread(threadId);
    const confirmed = await io.confirm(`Reply to ${thread.counterpart} on "${thread.subject || "(no subject)"}"? This sends a real email and costs 1 credit. [y/N] `);
    if (!confirmed) {
      console.error("Not sent.");
      return EXIT.rejected;
    }
  }
  const result = await client().reply(threadId, { text, idempotencyKey: flag(args, "key") });
  if (has(args, "json")) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.duplicate ? "already queued" : "queued"} ${result.id} → ${result.to}  ${result.subject}`);
  return EXIT.ok;
}

export async function cmdRead(args: string[], client: () => StormGTM): Promise<number> {
  const ids = positionals(args);
  if (ids.length === 0) throw usageError(READ_USAGE);
  const read = !has(args, "unread");
  const result = await client().markRead(ids, read);
  if (result.updated === 0) throw new CommandError("No matching threads.", EXIT.failed);
  console.log(`Marked ${result.updated} thread${result.updated === 1 ? "" : "s"} ${read ? "read" : "unread"}.`);
  return EXIT.ok;
}
