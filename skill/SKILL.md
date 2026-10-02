---
name: stormgtm-gtm
description: Find leads with StormGTM Radar, qualify every lead with Barometer before emailing it, send only to deliverable addresses, report outcomes, and use Send and sequences for outreach.
---

# StormGTM

Use this skill to qualify leads with Barometer before you send anything, then send and follow up through StormGTM. A bounce costs sender reputation; one check costs a credit or less.

## When to use

Any time you are about to email an address you did not get from a verified source: cold outreach, a scraped or enriched list, a CSV import, a lead an agent found. Also when the user says check, verify, qualify, or "will this email land", or asks to send through their connected domains. Also when the user asks for leads, prospects or people to email for a website or an ideal customer.

Not for newsletters to opted-in subscribers or transactional mail.

## Install (Claude Code / Cursor / Agents)

```bash
stormgtm skill install --claude
stormgtm skill install --cursor
# or all three: stormgtm skill install --claude --cursor --agents
```

That writes `.claude/skills/stormgtm-gtm/SKILL.md`, `.cursor/skills/stormgtm-gtm/SKILL.md`, and/or `.agents/skills/stormgtm-gtm/SKILL.md` in the current project, next to the `stormgtm-send` skill.

MCP server:

```bash
curl -fsSL https://stormgtm.com/install.sh | bash -s -- --mcp
# or: npm i -g stormgtm stormgtm-mcp
claude mcp add stormgtm -- npx -y stormgtm-mcp
```

Cursor `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "stormgtm": {
      "command": "npx",
      "args": ["-y", "stormgtm-mcp"]
    }
  }
}
```

CLI only:

```bash
npm i -g stormgtm
stormgtm login
```

`stormgtm login` signs in through the browser; `stormgtm login --key` pastes an `sgtm_live_...` key instead.

## Preconditions

1. Prefer the `stormgtm` MCP server. Call `whoami`. If MCP is missing, require `stormgtm whoami --json` to exit 0. If neither works, stop and print the install commands above.
2. Call `credits` (or `stormgtm me --json`). If the balance is 0, say so and stop.

## Find leads with Radar

Radar (beta) finds people to email from a website URL or a description of the ideal customer.

1. Call `find_leads` with the URL or description (CLI: `stormgtm radar "acme.io"`). It can take a minute or two. Each new lead with an email costs 1 credit; searches that find nobody are free. Pass the returned `chatId` to refine the same search.
2. Radar leads are not checked yet. Qualify them with `qualify_radar_leads` (CLI: `stormgtm qualify-leads <lead-id...>`), or with `check_lead` when you have more context.
3. Send only to leads that come back `deliverable`, following the workflow below. `list_radar_leads` (CLI: `stormgtm leads`) shows leads found earlier with their verdicts.

## Workflow

1. Gather everything you know about the lead: name, company, company domain, title, GitHub login, source URL. Context turns "risky" answers into confident ones, so pass all of it.
2. Check with `check_lead` (CLI: `stormgtm check <email> --name ... --company ...`). Use `tier: "deep"` (CLI: `--deep`) only when a fast check came back risky and the lead is worth the extra cost.
3. For more than about 20 leads call `check_batch`, then poll `batch_status` (CLI: `stormgtm batch leads.csv --wait`).
4. Act on the verdict:
   - `deliverable` with `policy.allowed` true: safe to send.
   - `risky`: not proven. Add context and recheck, use the deep tier, or ask the user. Do not send on a guess.
   - `undeliverable`: drop it.
   - `unknown`: free. Retry later or put it in a batch, which retries on its own. Never treat it as deliverable.
5. Send only to checked addresses, with `send_email` from a verified domain (see the `stormgtm-send` skill). Pass an `idempotencyKey` on each message, such as the lead id plus the step so a retry never sends twice.
6. Report what happened with `report_outcome` (CLI: `stormgtm outcome <email> <kind>`): `bounced`, `complained`, `replied`, `opened` or `delivered`. Outcomes make later checks sharper and stop repeat mistakes.

## Sequences

A sequence sends a series of follow-up emails per lead and stops by itself when the lead replies, unsubscribes, bounces or complains.

1. Create it once per campaign with `create_sequence`: a name, a sender on a verified domain with receiving turned on so replies are caught, and up to 10 steps, each with `delayHours`, a subject and a body. Use `{{firstName}}`-style placeholders. The result lists the variables each lead needs.
2. Enroll only leads that passed a check with `enroll_leads`, giving every variable the sequence needs. Enrolling the same lead twice does nothing. CLI: `stormgtm enroll <sequence-id> leads.csv`, where the `email` column is the address and the other columns are variables.
3. Follow progress with `sequence_status` (CLI: `stormgtm sequences`, `stormgtm sequence <sequence-id>`). Stop one lead with `stop_enrollment`.

The `stormgtm-send` skill covers replies and domain limits.

## Rules

- Never email or enroll an address that was not checked in this task.
- Send only on `deliverable` with `policy.allowed` true. `risky` needs more context or a human; `undeliverable` is dropped.
- `unknown` is free to retry and is never a reason to send.
- Pass every piece of context you have on every check.
- Always report outcomes for bounces, complaints and replies.
- Never send from a domain that is not verified, and never try to bypass a paused domain or the daily limit.
- Do not paste API keys into chat, files or commits. The key lives in `~/.stormgtm/config.json` or `STORMGTM_API_KEY`.
- Do not retry a failed check in a tight loop; a repeated identical request spends credits.

## Fallback (no MCP)

```bash
stormgtm check jane@acme.io --name "Jane Doe" --company Acme --json
stormgtm batch leads.csv --wait --json
stormgtm outcome jane@acme.io bounced
```

`stormgtm check` exits 2 when the lead is undeliverable. Parse stdout as JSON with `--json`.
