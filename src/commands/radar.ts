import { EXIT, usageError } from "../errors.js";
import { readSecretLine } from "../secret-input.js";
import type { AddLeadInput, LeadsforgeStatus, RadarEvent, RadarLead, StormGTM, Tier } from "../index.js";

export const RADAR_USAGE = 'stormgtm radar "<website or description>" [--chat <chat-id>] [--json]';
export const LEADS_USAGE = "stormgtm leads [--chat <chat-id>] [--json | --csv]";
export const QUALIFY_LEADS_USAGE = "stormgtm qualify-leads <lead-id...> [--deep] [--json]";
export const ADD_LEADS_USAGE = "stormgtm add-leads <file.csv | email...> [--json]";
export const LEADSFORGE_USAGE = "stormgtm leadsforge [connect | disconnect] [--json]";

const VALUE_FLAGS = new Set(["--chat"]);

export interface RadarIo {
  out(line: string): void;
  progress(line: string): void;
}

export const consoleRadarIo: RadarIo = {
  out: (line) => console.log(line),
  progress: (line) => console.error(line),
};

export type ReadLeadsCsv = (file: string) => AddLeadInput[];
export type ReadSecret = (prompt: string) => Promise<string>;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionals(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (VALUE_FLAGS.has(arg)) index++;
    else if (!arg.startsWith("--")) values.push(arg);
  }
  return values;
}

export function leadLine(lead: Pick<RadarLead, "email" | "name" | "title" | "company">): string {
  const details = [lead.name, lead.title, lead.company].filter((value): value is string => Boolean(value?.trim())).join(" · ");
  return details ? `${lead.email}  ${details}` : lead.email;
}

export const LEAD_CSV_COLUMNS = ["name", "email", "title", "company", "company site", "source URL", "note", "verdict", "found date"] as const;

export function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]|^\s|\s$/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function leadsCsv(leads: RadarLead[]): string {
  const rows = leads.map((lead) => [
    lead.name,
    lead.email,
    lead.title,
    lead.company,
    lead.companyHost,
    lead.sourceUrl,
    lead.note,
    lead.verdict ?? "not checked",
    lead.createdAt.slice(0, 10),
  ]);
  return [LEAD_CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function progressLine(event: RadarEvent): string | null {
  if (event.type !== "tool") return null;
  if (event.phase === "start") return `· ${event.summary}`;
  return event.isError ? `  ${event.summary}` : null;
}

export async function cmdRadar(args: string[], client: () => StormGTM, io: RadarIo = consoleRadarIo): Promise<number> {
  const content = positionals(args).join(" ").trim();
  const chatOption = flag(args, "chat");
  if (!content || (args.includes("--chat") && (!chatOption || chatOption.startsWith("--")))) throw usageError(RADAR_USAGE);
  const json = args.includes("--json");
  const result = await client().findLeads({
    content,
    chatId: chatOption,
    onEvent: json
      ? undefined
      : (event) => {
          const line = progressLine(event);
          if (line) io.progress(line);
          if (event.type === "leads") for (const lead of event.leads) io.out(leadLine(lead));
        },
  });
  if (json) io.out(JSON.stringify(result, null, 2));
  else {
    if (result.answer.trim()) io.out(`\n${result.answer.trim()}`);
    io.progress(`${result.leads.length} new lead${result.leads.length === 1 ? "" : "s"} in chat ${result.chatId}`);
  }
  return result.leads.length > 0 ? EXIT.ok : EXIT.rejected;
}

export async function cmdLeads(args: string[], client: () => StormGTM, io: RadarIo = consoleRadarIo): Promise<number> {
  const chatId = flag(args, "chat");
  const csv = args.includes("--csv");
  if ((args.includes("--chat") && (!chatId || chatId.startsWith("--"))) || (csv && args.includes("--json"))) throw usageError(LEADS_USAGE);
  const leads = await client().radarLeads({ chatId });
  if (csv) io.out(leadsCsv(leads).replace(/\r\n$/, ""));
  else if (args.includes("--json")) io.out(JSON.stringify(leads, null, 2));
  else if (leads.length === 0) io.out("No leads yet. Find some with: stormgtm radar <website>");
  else for (const lead of leads) io.out(`${lead.id}  ${leadLine(lead)}${lead.verdict ? `  [${lead.verdict}]` : ""}${originLabel(lead)}`);
  return EXIT.ok;
}

const ORIGIN_LABELS: Record<RadarLead["origin"], string> = { web: "", leadsforge: "  (Leadsforge)", manual: "  (added)" };

export function originLabel(lead: Pick<RadarLead, "origin">): string {
  return ORIGIN_LABELS[lead.origin] ?? "";
}

export async function cmdAddLeads(args: string[], client: () => StormGTM, readCsv: ReadLeadsCsv, io: RadarIo = consoleRadarIo): Promise<number> {
  const values = positionals(args);
  if (values.length === 0) throw usageError(ADD_LEADS_USAGE);
  const leads = values.length === 1 && /\.csv$/i.test(values[0]!) ? readCsv(values[0]!) : values.map((email) => ({ email }));
  if (leads.length === 0) throw usageError(`No leads in ${values[0]}. ${ADD_LEADS_USAGE}`);
  const result = await client().addRadarLeads(leads);
  if (args.includes("--json")) io.out(JSON.stringify(result, null, 2));
  else {
    for (const lead of result.leads) io.out(`${lead.id}  ${leadLine(lead)}`);
    for (const entry of result.rejected) io.progress(`Skipped ${leads[entry.index]?.email ?? `row ${entry.index + 1}`}: ${entry.message}`);
    if (result.duplicates.length) io.progress(`${result.duplicates.length} already in your leads`);
    io.progress(`${result.leads.length} lead${result.leads.length === 1 ? "" : "s"} added, free. Qualify them with: stormgtm qualify-leads <lead-id...>`);
  }
  return result.leads.length > 0 || result.duplicates.length > 0 ? EXIT.ok : EXIT.rejected;
}

function leadsforgeLine(status: LeadsforgeStatus): string {
  if (!status.connected) return "Leadsforge is not connected. Connect it with: stormgtm leadsforge connect";
  const credits = status.credits === undefined ? "" : `, ${status.credits} Leadsforge credits`;
  return `Leadsforge connected (key ${status.keyHint ?? "saved"}${credits}). Radar also searches the Leadsforge people database; leads found there are free.`;
}

export async function cmdLeadsforge(args: string[], client: () => StormGTM, io: RadarIo = consoleRadarIo, readSecret: ReadSecret = readSecretLine): Promise<number> {
  const [action] = positionals(args);
  const json = args.includes("--json");
  if (action !== undefined && action !== "connect" && action !== "disconnect") throw usageError(LEADSFORGE_USAGE);
  if (action === "disconnect") {
    await client().disconnectLeadsforge();
    io.out(json ? JSON.stringify({ connected: false }, null, 2) : "Leadsforge disconnected.");
    return EXIT.ok;
  }
  if (action === "connect") {
    const apiKey = (await readSecret("Paste your Leadsforge API key (Leadsforge → Usage → API & MCP): ")).trim();
    if (!apiKey) throw usageError(`No key entered. ${LEADSFORGE_USAGE}`);
    const status = await client().connectLeadsforge(apiKey);
    io.out(json ? JSON.stringify(status, null, 2) : leadsforgeLine(status));
    return EXIT.ok;
  }
  const status = await client().leadsforge();
  io.out(json ? JSON.stringify(status, null, 2) : leadsforgeLine(status));
  return EXIT.ok;
}

export async function cmdQualifyLeads(args: string[], client: () => StormGTM, io: RadarIo = consoleRadarIo): Promise<number> {
  const ids = positionals(args);
  if (ids.length === 0) throw usageError(QUALIFY_LEADS_USAGE);
  const tier: Tier = args.includes("--deep") ? "deep" : "fast";
  const result = await client().qualifyRadarLeads(ids, tier);
  if (args.includes("--json")) io.out(JSON.stringify(result, null, 2));
  else {
    for (const lead of result.leads) io.out(`${lead.email}: ${lead.verdict ?? "unknown"}`);
    if (result.remaining > 0) io.progress(`${result.remaining} lead${result.remaining === 1 ? "" : "s"} not checked yet; run the command again for them.`);
  }
  return EXIT.ok;
}
