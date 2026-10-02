import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "stormgtm-gtm";
export const SEND_SKILL_NAME = "stormgtm-send";
export const SKILL_NAMES = [SKILL_NAME, SEND_SKILL_NAME] as const;

export type SkillName = (typeof SKILL_NAMES)[number];
export type SkillTarget = "claude" | "cursor" | "agents";

export const SKILL_USAGE = `usage:
  stormgtm skill install --claude|--cursor|--agents [--json]

  Copies ${SKILL_NAMES.join(", ")} into this project (git toplevel, else cwd):
    --claude  .claude/skills/<name>/SKILL.md
    --cursor  .cursor/skills/<name>/SKILL.md
    --agents  .agents/skills/<name>/SKILL.md
  Pass several flags to write several trees. Overwrites existing copies.`;

export class SkillError extends Error {}

export interface SkillInstallRequest {
  help: boolean;
  json: boolean;
  targets: SkillTarget[];
}

export function parseSkillArgs(args: string[]): SkillInstallRequest {
  const [sub, ...rest] = args;
  if (!sub || sub === "-h" || sub === "--help" || sub === "help") return { help: true, json: false, targets: [] };
  if (sub !== "install") throw new SkillError(`${SKILL_USAGE}\nunknown skill subcommand: ${sub}`);
  let json = false;
  const targets: SkillTarget[] = [];
  for (const arg of rest) {
    if (arg === "--json") json = true;
    else if (arg === "--claude" || arg === "--cursor" || arg === "--agents") {
      const target = arg.slice(2) as SkillTarget;
      if (!targets.includes(target)) targets.push(target);
    } else if (arg === "-h" || arg === "--help" || arg === "help") return { help: true, json: false, targets: [] };
    else throw new SkillError(`${SKILL_USAGE}\nunknown flag: ${arg}`);
  }
  if (targets.length === 0) throw new SkillError(`${SKILL_USAGE}\npass --claude, --cursor and/or --agents`);
  return { help: false, json, targets };
}

export function skillInstallRoot(cwd = process.cwd()): string {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return top ? path.resolve(top) : path.resolve(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

export function skillDestination(root: string, target: SkillTarget, name: SkillName = SKILL_NAME): string {
  return path.join(root, `.${target}`, "skills", name, "SKILL.md");
}

export function resolveBundledSkillPath(fromFile = import.meta.url, name: SkillName = SKILL_NAME): string {
  const here = path.dirname(fileURLToPath(fromFile));
  const packageRoot = path.resolve(here, "..", "..");
  const candidates = [
    name === SKILL_NAME ? path.join(packageRoot, "skill", "SKILL.md") : path.join(packageRoot, "skill", name, "SKILL.md"),
    path.join(packageRoot, "..", "..", "skills", name, "SKILL.md"),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new SkillError(`${name} skill is missing (looked in ${candidates.join(" and ")})`);
}

async function assertNoSymlink(root: string, dest: string): Promise<void> {
  const relative = path.relative(root, dest).split(path.sep);
  let current = root;
  for (const part of relative) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new SkillError(`refusing to write skill through symlink: ${current}`);
  }
}

export async function writeSkillCopies(root: string, sourcePath: string, destinations: string[]): Promise<string[]> {
  const body = readFileSync(sourcePath, "utf8");
  const written: string[] = [];
  for (const dest of destinations) {
    await assertNoSymlink(root, dest);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, body, "utf8");
    written.push(dest);
  }
  return written;
}

export async function cmdSkill(args: string[], options: { cwd?: string } = {}): Promise<number> {
  let request: SkillInstallRequest;
  try {
    request = parseSkillArgs(args);
  } catch (error) {
    if (error instanceof SkillError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  if (request.help) {
    console.log(SKILL_USAGE);
    return 0;
  }
  try {
    const root = skillInstallRoot(options.cwd);
    const sources: Record<string, string> = {};
    const written: string[] = [];
    for (const name of SKILL_NAMES) {
      const source = resolveBundledSkillPath(undefined, name);
      sources[name] = source;
      written.push(...(await writeSkillCopies(root, source, request.targets.map((target) => skillDestination(root, target, name)))));
    }
    if (request.json) console.log(JSON.stringify({ names: SKILL_NAMES, sources, written }, null, 2));
    else {
      console.log(`Installed ${SKILL_NAMES.join(" and ")}`);
      for (const dest of written) console.log(`  ${dest}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof SkillError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}
