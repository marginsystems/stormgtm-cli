import { EXIT, usageError } from "../errors.js";
import type { RadarEvent, RadarLead, StormGTM, Tier } from "../index.js";

export const RADAR_USAGE = 'stormgtm radar "<website or description>" [--chat <chat-id>] [--json]';
export const LEADS_USAGE = "stormgtm leads [--chat <chat-id>] [--json]";
export const QUALIFY_LEADS_USAGE = "stormgtm qualify-leads <lead-id...> [--deep] [--json]";

const VALUE_FLAGS = new Set(["--chat"]);

export interface RadarIo {
  out(line: string): void;
  progress(line: string): void;
}

export const consoleRadarIo: RadarIo = {
  out: (line) => console.log(line),
  progress: (line) => console.error(line),
};

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
  if (args.includes("--chat") && (!chatId || chatId.startsWith("--"))) throw usageError(LEADS_USAGE);
  const leads = await client().radarLeads({ chatId });
  if (args.includes("--json")) io.out(JSON.stringify(leads, null, 2));
  else if (leads.length === 0) io.out("No leads yet. Find some with: stormgtm radar <website>");
  else for (const lead of leads) io.out(`${lead.id}  ${leadLine(lead)}${lead.verdict ? `  [${lead.verdict}]` : ""}`);
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
