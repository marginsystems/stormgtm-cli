#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cmdLogin, cmdLogout, cmdWhoami } from "./commands/auth.js";
import { cmdConfig, cmdKeys } from "./commands/config.js";
import { cmdCounts, cmdInbox, cmdRead, cmdReply, cmdThread, cmdThreadAction, isThreadAction, processIo, type InboxIo } from "./commands/inbox.js";
import { cmdLeads, cmdQualifyLeads, cmdRadar } from "./commands/radar.js";
import { cmdSkill } from "./commands/skill.js";
import { VERSION } from "./version.js";
import { resolveApiUrl } from "./config.js";
import { CommandError, describeError, EXIT, usageError } from "./errors.js";
import { clientFromEnv, summarize, type LeadContext, type StormGTM, type OutcomeKind, type Tier } from "./index.js";

export const USAGE = `stormgtm ${VERSION}: qualify leads and send to the ones worth emailing (also installed as sgtm)

Account
  stormgtm login                 Sign in through the browser and save an API key
  stormgtm login --key           Paste an existing API key instead (headless, CI)
  stormgtm logout                Remove the saved API key
  stormgtm whoami [--json]       Account, credits, key and API URL (alias: status)
  stormgtm keys                  Open the API keys page in the dashboard
  stormgtm config [--json]       Show where the key and API URL come from
  stormgtm config set api-url <url> | unset api-url | path

Agents
  stormgtm skill install --claude|--cursor|--agents [--json]

Leads
  stormgtm check <email> [--deep] [--name "Jane Doe"] [--company Acme] [--github janedoe] [--json]
  stormgtm batch <file.csv> [--deep] [--wait] [--json]
  stormgtm batch-status <batch-id> [--json]
  stormgtm outcome <email> <delivered|bounced|replied|opened|complained>
  stormgtm me [--json]

Radar (beta)
  stormgtm radar "<website or description>" [--chat <chat-id>] [--json]
                                 Finds people to email; 1 credit per new lead with an email, free if none. Exit 2 if none
  stormgtm leads [--chat <chat-id>] [--json]
  stormgtm qualify-leads <lead-id...> [--deep] [--json]

Sending (beta)
  stormgtm send --from "Ada <ada@mail.example.com>" --to <email> --subject <text> (--text <body> | --html-file <file>) [--key <idempotency-key>] [--json]
  stormgtm domains [--json]
  stormgtm domain-health <domain-id> [--json]
  stormgtm emails [--json]
  stormgtm sequences [--json]
  stormgtm sequence <sequence-id> [--json]
  stormgtm enroll <sequence-id> <file.csv> [--json]   CSV with an email column; other columns become variables

Inbox (beta)
  stormgtm inbox [--folder inbox|sent|archived|spam] [--unread] [--search <query>] [--cursor <cursor>] [--json]
  stormgtm thread <thread-id> [--full] [--json]
  stormgtm reply <thread-id> (--text <text> | < reply.txt) [--key <idempotency-key>] [--yes] [--json]
                                 Replies to the thread's participant only; 1 credit. Asks first in a terminal unless --yes
  stormgtm read <thread-id...> [--unread]
  stormgtm unread|archive|unarchive|spam|unspam <thread-id...>
                                 spam also suppresses the sender, so they are never emailed again, and stops their sequences
  stormgtm counts [--json]       Total and unread threads per folder

Auth: "stormgtm login", or set STORMGTM_API_KEY. STORMGTM_API_URL overrides the API (default https://stormgtm.com).
Config: ~/.stormgtm/config.json

Exit codes: 0 ok, 1 error, 2 lead undeliverable, nothing sent or no leads found, 3 usage, 4 out of credits, 6 not logged in or key rejected, 7 rate limited`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function parseEnrollCsv(text: string): Array<{ email: string; variables?: Record<string, string> }> {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((cell, index) => (index === 0 ? cell.replace(/^\uFEFF/, "") : cell));
  const emailIndex = header.findIndex((cell) => ["email", "work_email", "email_address"].includes(cell.toLowerCase()));
  if (emailIndex < 0) {
    if (header.length > 1) throw new Error("Enrollment CSV must include an email column");
    return rows.map((row) => ({ email: row[0] ?? "" })).filter((lead) => lead.email);
  }
  return rows
    .slice(1)
    .map((cells) => {
      const variables: Record<string, string> = {};
      header.forEach((column, index) => {
        if (index !== emailIndex && column && cells[index]) variables[column] = cells[index]!;
      });
      const email = cells[emailIndex] ?? "";
      return Object.keys(variables).length ? { email, variables } : { email };
    })
    .filter((lead) => lead.email);
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.trim().length === 0) quoted = true;
    else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(cell.trim());
      if (row.some((value) => value)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some((value) => value)) rows.push(row);
  return rows;
}

export function parseCsv(text: string): Array<{ email: string; context?: LeadContext }> {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((cell, index) => (index === 0 ? cell.replace(/^\uFEFF/, "") : cell));
  const lower = header.map((cell) => cell.toLowerCase());
  const hasHeader = lower.includes("email");
  const columns = hasHeader ? header : ["email"];
  const contextKeys = new Set(["name", "firstName", "lastName", "company", "companyDomain", "title", "source", "sourceUrl", "githubLogin", "linkedinUrl", "notes"]);
  return (hasHeader ? rows.slice(1) : rows)
    .map((cells) => {
      const context: Record<string, string> = {};
      let email = "";
      columns.forEach((column, index) => {
        const value = cells[index];
        if (!value) return;
        if (column.toLowerCase() === "email") email = value;
        else if (contextKeys.has(column)) context[column] = value;
      });
      return Object.keys(context).length ? { email, context } : { email };
    })
    .filter((lead) => lead.email);
}

const OUTCOME_KINDS: OutcomeKind[] = ["delivered", "bounced", "replied", "opened", "complained"];

const KNOWN_COMMANDS = new Set(["me", "check", "batch", "batch-status", "outcome", "send", "domains", "domain-health", "emails", "sequences", "sequence", "enroll", "inbox", "thread", "reply", "read", "unread", "archive", "unarchive", "spam", "unspam", "counts", "radar", "leads", "qualify-leads"]);

export async function main(argv: string[], io: InboxIo = processIo): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    return EXIT.ok;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    return EXIT.ok;
  }
  if (command === "login") return cmdLogin(args);
  if (command === "logout") return cmdLogout();
  if (command === "whoami" || command === "status") return cmdWhoami(args);
  if (command === "config") return cmdConfig(args);
  if (command === "keys") return cmdKeys();
  if (command === "skill") return cmdSkill(args);
  if (!KNOWN_COMMANDS.has(command)) throw new CommandError(`Unknown command: ${command}. Run \`stormgtm help\` to see all commands.`, EXIT.usage);
  let cached: StormGTM | undefined;
  const client = (): StormGTM => (cached ??= clientFromEnv());
  const json = has(args, "json");
  const tier: Tier = has(args, "deep") ? "deep" : "fast";

  if (command === "inbox") return cmdInbox(args, client);
  if (command === "thread") return cmdThread(args, client);
  if (command === "reply") return cmdReply(args, client, io);
  if (command === "read") return cmdRead(args, client);
  if (command === "counts") return cmdCounts(args, client);
  if (isThreadAction(command)) return cmdThreadAction(command, args, client);
  if (command === "radar") return cmdRadar(args, client);
  if (command === "leads") return cmdLeads(args, client);
  if (command === "qualify-leads") return cmdQualifyLeads(args, client);

  if (command === "me") {
    const me = await client().me();
    console.log(json ? JSON.stringify(me, null, 2) : `${me.email}: ${me.credits} credits (fast ${me.pricing.fast}, deep ${me.pricing.deep})`);
    return EXIT.ok;
  }
  if (command === "check") {
    const email = args[0];
    if (!email || email.startsWith("--")) throw usageError("stormgtm check <email>");
    const context: LeadContext = {};
    const name = flag(args, "name");
    const company = flag(args, "company");
    const github = flag(args, "github");
    if (name) context.name = name;
    if (company) context.company = company;
    if (github) context.githubLogin = github;
    const result = await client().check({ email, tier, context: Object.keys(context).length ? context : undefined });
    console.log(json ? JSON.stringify(result, null, 2) : summarize(result));
    return result.verdict === "undeliverable" ? EXIT.rejected : EXIT.ok;
  }
  if (command === "batch") {
    const file = args[0];
    if (!file) throw usageError("stormgtm batch <file.csv>");
    const leads = parseCsv(readFileSync(file, "utf8"));
    const created = await client().createBatch({ leads, tier });
    if (!has(args, "wait")) {
      console.log(json ? JSON.stringify(created, null, 2) : `batch ${created.id} queued: ${created.total} leads, up to ${created.maxCredits} credits`);
      return EXIT.ok;
    }
    const status = await client().waitForBatch(created.id);
    if (json) console.log(JSON.stringify(status, null, 2));
    else for (const row of status.results) console.log(row.result ? summarize(row.result) : `${row.email}: ${row.status}`);
    return EXIT.ok;
  }
  if (command === "batch-status") {
    const id = args[0];
    if (!id) throw usageError("stormgtm batch-status <id>");
    const status = await client().batch(id, { limit: 1000 });
    if (json) console.log(JSON.stringify(status, null, 2));
    else console.log(`${status.id}: ${status.status} ${status.done}/${status.total}`);
    return EXIT.ok;
  }
  if (command === "outcome") {
    const [email, kind] = args;
    if (!email || !kind || !OUTCOME_KINDS.includes(kind as OutcomeKind)) throw usageError(`stormgtm outcome <email> <${OUTCOME_KINDS.join("|")}>`);
    const result = await client().reportOutcome({ email, kind: kind as OutcomeKind });
    console.log(json ? JSON.stringify(result) : `recorded ${result.recorded}`);
    return EXIT.ok;
  }
  if (command === "send") {
    const from = flag(args, "from");
    const to = flag(args, "to");
    const subject = flag(args, "subject");
    const text = flag(args, "text");
    const htmlFile = flag(args, "html-file");
    if (!from || !to || !subject || (!text && !htmlFile)) throw usageError("stormgtm send --from <sender> --to <email> --subject <text> (--text <body> | --html-file <file>)");
    const result = await client().send({ from, to, subject, text, html: htmlFile ? readFileSync(htmlFile, "utf8") : undefined, idempotencyKey: flag(args, "key") });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const entry of result.accepted) console.log(`queued ${entry.id} → ${entry.to}`);
      for (const entry of result.rejected) console.log(`rejected: ${entry.code} — ${entry.message}`);
    }
    return result.accepted.length > 0 ? EXIT.ok : EXIT.rejected;
  }
  if (command === "domains") {
    const domains = await client().domains();
    if (json) console.log(JSON.stringify(domains, null, 2));
    else for (const domain of domains) console.log(`${domain.id}  ${domain.name}  ${domain.status}  ${domain.warmup.paused ? "paused" : `${domain.warmup.dailyCap}/day`}`);
    return EXIT.ok;
  }
  if (command === "domain-health") {
    const id = args[0];
    if (!id || id.startsWith("--")) throw usageError("stormgtm domain-health <domain-id>");
    const health = await client().domainHealth(id);
    if (json) console.log(JSON.stringify(health, null, 2));
    else
      console.log(
        `${health.name}: ${health.warmup.paused ? `paused (${health.warmup.pausedReason ?? "manual"})` : `${health.warmup.remainingToday}/${health.warmup.dailyCap} left today`}, 7d ${health.last7Days.sent} sent, ${(health.last7Days.bounceRate * 100).toFixed(1)}% bounced`,
      );
    return EXIT.ok;
  }
  if (command === "emails") {
    const emails = await client().emails();
    if (json) console.log(JSON.stringify(emails, null, 2));
    else for (const email of emails) console.log(`${email.id}  ${email.to}  ${email.status}/${email.delivery}  ${email.subject}`);
    return EXIT.ok;
  }
  if (command === "sequences") {
    const sequences = await client().sequences();
    if (json) console.log(JSON.stringify(sequences, null, 2));
    else for (const entry of sequences) console.log(`${entry.id}  ${entry.name}  ${entry.steps} steps  ${entry.counts.active} active / ${entry.counts.completed} completed / ${entry.counts.stopped} stopped`);
    return EXIT.ok;
  }
  if (command === "sequence") {
    const id = args[0];
    if (!id || id.startsWith("--")) throw usageError("stormgtm sequence <sequence-id>");
    const [sequence, enrollments] = await Promise.all([client().sequence(id), client().enrollments(id, 500)]);
    if (json) console.log(JSON.stringify({ sequence, enrollments }, null, 2));
    else {
      console.log(`${sequence.id}  ${sequence.name}  from ${sequence.from}  variables: ${sequence.variables.join(", ") || "none"}`);
      for (const entry of enrollments) console.log(`  ${entry.email}  ${entry.status}${entry.stopReason ? ` (${entry.stopReason})` : ""}`);
    }
    return EXIT.ok;
  }
  if (command === "enroll") {
    const [id, file] = args;
    if (!id || !file) throw usageError("stormgtm enroll <sequence-id> <file.csv>");
    const result = await client().enroll(id, parseEnrollCsv(readFileSync(file, "utf8")));
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.accepted.filter((entry) => !entry.duplicate).length} enrolled, ${result.rejected.length} rejected, up to ${result.maxCredits} credits`);
      for (const entry of result.rejected) console.log(`  row ${entry.index + 1}: ${entry.code} — ${entry.message}`);
    }
    return result.accepted.length > 0 ? EXIT.ok : EXIT.rejected;
  }
  throw new CommandError(`Unknown command: ${command}. Run \`stormgtm help\` to see all commands.`, EXIT.usage);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      const { message, exitCode } = describeError(error, resolveApiUrl());
      console.error(message);
      process.exit(exitCode);
    },
  );
}
