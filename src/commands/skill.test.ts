import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSkillArgs, resolveBundledSkillPath, skillDestination, skillInstallRoot, SKILL_NAMES, SkillError, writeSkillCopies } from "./skill.js";

function temp(): string {
  return mkdtempSync(path.join(tmpdir(), "sgtm-skill-"));
}

test("parses targets and flags", () => {
  assert.deepEqual(parseSkillArgs(["install", "--claude", "--agents", "--claude", "--json"]), { help: false, json: true, targets: ["claude", "agents"] });
  assert.equal(parseSkillArgs([]).help, true);
  assert.throws(() => parseSkillArgs(["install"]), SkillError);
  assert.throws(() => parseSkillArgs(["install", "--vim"]), /unknown flag/);
  assert.throws(() => parseSkillArgs(["remove"]), /unknown skill subcommand/);
});

test("destinations follow each tool's skills directory", () => {
  assert.equal(skillDestination("/p", "claude"), path.join("/p", ".claude", "skills", "stormgtm-gtm", "SKILL.md"));
  assert.equal(skillDestination("/p", "cursor", "stormgtm-send"), path.join("/p", ".cursor", "skills", "stormgtm-send", "SKILL.md"));
  assert.equal(skillDestination("/p", "agents"), path.join("/p", ".agents", "skills", "stormgtm-gtm", "SKILL.md"));
});

test("bundled skills resolve from the monorepo skills directory", () => {
  for (const name of SKILL_NAMES) {
    const resolved = resolveBundledSkillPath(undefined, name);
    assert.match(readFileSync(resolved, "utf8"), new RegExp(`^---\\nname: ${name}\\n`));
  }
});

test("prefers the package skill directory over the monorepo copy", () => {
  const pkg = temp();
  mkdirSync(path.join(pkg, "dist", "commands"), { recursive: true });
  mkdirSync(path.join(pkg, "skill", "stormgtm-send"), { recursive: true });
  writeFileSync(path.join(pkg, "skill", "SKILL.md"), "main");
  writeFileSync(path.join(pkg, "skill", "stormgtm-send", "SKILL.md"), "send");
  const from = new URL(`file://${path.join(pkg, "dist", "commands", "skill.js")}`).href;
  assert.equal(resolveBundledSkillPath(from, "stormgtm-gtm"), path.join(pkg, "skill", "SKILL.md"));
  assert.equal(resolveBundledSkillPath(from, "stormgtm-send"), path.join(pkg, "skill", "stormgtm-send", "SKILL.md"));
});

test("writes copies and overwrites existing ones", async () => {
  const root = temp();
  const source = path.join(temp(), "SKILL.md");
  writeFileSync(source, "new body");
  const dest = skillDestination(root, "claude");
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, "old body");
  assert.deepEqual(await writeSkillCopies(root, source, [dest]), [dest]);
  assert.equal(readFileSync(dest, "utf8"), "new body");
});

test("refuses to write through a symlink", async () => {
  const root = temp();
  const elsewhere = temp();
  const source = path.join(temp(), "SKILL.md");
  writeFileSync(source, "body");
  symlinkSync(elsewhere, path.join(root, ".claude"));
  await assert.rejects(writeSkillCopies(root, source, [skillDestination(root, "claude")]), /symlink/);

  const root2 = temp();
  const dest = skillDestination(root2, "cursor");
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(path.join(elsewhere, "target.md"), "keep");
  symlinkSync(path.join(elsewhere, "target.md"), dest);
  await assert.rejects(writeSkillCopies(root2, source, [dest]), /symlink/);
  assert.equal(readFileSync(path.join(elsewhere, "target.md"), "utf8"), "keep");
});

test("install root is the git toplevel, else the cwd", () => {
  const plain = temp();
  assert.equal(skillInstallRoot(plain), path.resolve(plain));
});
