---
name: stormgtm-send
description: Send email through StormGTM on your own verified domains, follow each domain's warm-up, run follow-up sequences, and handle replies and bounces.
---

# StormGTM Send

Use this skill to send checked leads email through the user's own Resend account and domains, at a pace that protects their reputation.

## When to use

After a lead has passed Barometer (see the `stormgtm-gtm` skill) and the user wants it emailed. Also for adding a sending domain, checking how much a domain can send today, following a queued email, or running follow-up sequences.

Send is in beta.

## Install (Claude Code / Cursor / Agents)

```bash
stormgtm skill install --claude
# or --cursor, or --agents
```

MCP server:

```bash
claude mcp add stormgtm -- npx -y stormgtm-mcp
```

CLI only: `npm i -g stormgtm && stormgtm login`.

## Preconditions

1. Call `whoami` (or `stormgtm whoami`). Stop if it fails.
2. The user connects their Resend key in the dashboard at `/app/send`. Never ask for it in chat and never pass it through a tool.
3. Call `list_domains` (CLI: `stormgtm domains`). Send only from an address on a domain whose status is verified. If none is, tell the user to add and verify one in the dashboard.

## Workflow

1. Confirm the lead passed a check with a deliverable verdict and `policy.allowed` true.
2. Look at capacity with `domain_health` (CLI: `stormgtm domain-health <id>`). Note the daily limit and how much is left today. New domains start small and grow on their own.
3. Send with `send_email` (CLI: `stormgtm send --from ... --to ... --subject ... --text ...`). `send_email` takes a `messages` array (up to 100 per call); pass an `idempotencyKey` on every message.
4. Expect queueing. Delivery is paced through the domain's warm-up and can take minutes or hours. Follow an email with `email_status` (CLI: `stormgtm emails`); do not resend because it has not arrived yet.
5. Read `rejected` in the result. Codes: `invalid_from`, `invalid_to`, `domain_not_connected`, `domain_not_verified`, `suppressed`. Fix the cause or drop the lead; never work around `suppressed`.
6. Report outcomes with `report_outcome` when you learn of a bounce, complaint or reply.

## Warm-up and domain health

- Each domain has a daily limit that steps up over time. Do not try to exceed it by splitting across calls; extra sends wait for tomorrow.
- A domain pauses on its own when bounces or complaints climb. A paused domain sends nothing until the user lifts the pause in the dashboard. Tell the user why it paused; do not hide it.
- Each email costs 1 credit. Sends that fail are refunded.

## Sequences and replies

- Create a sequence with `create_sequence`: a sender on a verified domain, a `replyTo` address on a receiving domain so replies reach StormGTM, and up to 10 steps with `delayHours`, a subject and a body. `{{firstName}}`-style placeholders are filled from each lead's variables.
- Enroll checked leads with `enroll_leads` (CLI: `stormgtm enroll <sequence-id> leads.csv`) and supply every variable the sequence needs. Read `rejected` for leads missing variables or suppressed.
- A lead leaves the sequence on its own when they reply, unsubscribe, bounce or complain. Do not send manual follow-ups to someone in a running sequence.
- Follow progress with `sequence_status` (CLI: `stormgtm sequences`, `stormgtm sequence <sequence-id>`). Stop one lead with `stop_enrollment`; steps still waiting are cancelled and refunded.
- When a human reads a reply, report `replied` so the lead is not contacted again.

## Rules

- Never send to an address without a deliverable check, and never to one that bounced, complained or unsubscribed.
- Send only from verified domains. Do not guess at a from address.
- Always pass an `idempotencyKey` so retries cannot double-send.
- Do not retry a send that is queued. Check `email_status` first.
- Respect pauses and daily limits. Report them to the user instead of routing around them.
- Never put the Resend key or the StormGTM key in chat, files or commits.
