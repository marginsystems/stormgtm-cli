# stormgtm

CLI and typed client for [StormGTM](https://stormgtm.com). Barometer reviews an email lead before you send: give it an address plus whatever you know about the person, and get a verdict (`deliverable`, `risky`, `undeliverable`, `unknown`), a 0-100 score and plain-language reasons. Send (beta) emails the leads that pass, through your own Resend account and domains.

Requires **Node.js 22+**.

## Install

```bash
npm install -g stormgtm
stormgtm login
# the short alias runs the same binary:
sgtm whoami
```

Or the installer, which checks Node 22+ and runs `npm install -g stormgtm`:

```bash
curl -fsSL https://stormgtm.com/install.sh | bash
```

Add `-s -- --mcp` to also install the MCP server for agents.

## Sign in

```bash
stormgtm login          # opens your browser, confirm the code, done
stormgtm login --key    # paste an sgtm_live_... key (input is hidden)
stormgtm whoami         # email, credits, key prefix, API URL (alias: status)
stormgtm logout         # remove the stored key
stormgtm keys           # open the API keys page in the dashboard
stormgtm config         # where the key and API URL come from
stormgtm config set api-url http://localhost:8787   # or: config unset api-url
```

The key is stored in `~/.stormgtm/config.json` (mode 0600) as `{ "apiKey": "...", "apiUrl": "..." }`. Environment variables win over the file:

| Variable | Meaning |
| --- | --- |
| `STORMGTM_API_KEY` | API key (`sgtm_live_...`) |
| `STORMGTM_API_URL` | API base URL (default `https://stormgtm.com`) |

## Commands

```bash
stormgtm check jane@acme.io --name "Jane Doe" --company Acme
stormgtm check jane@acme.io --deep --json
stormgtm batch leads.csv --wait
stormgtm batch-status <batch-id>
stormgtm outcome jane@acme.io bounced
stormgtm send --from "Ada <ada@mail.acme.io>" --to jane@acme.io --subject "Hello" --text "Hi Jane"
stormgtm domains
stormgtm domain-health <domain-id>
stormgtm emails
stormgtm sequences
stormgtm sequence <sequence-id>
stormgtm enroll <sequence-id> leads.csv
stormgtm inbox --unread
stormgtm inbox --folder sent --search pricing
stormgtm thread <thread-id> --full
stormgtm reply <thread-id> --text "Thanks, here is the pricing."
echo "Thanks!" | stormgtm reply <thread-id>
stormgtm read <thread-id> <thread-id>
stormgtm unread <thread-id>
stormgtm archive <thread-id>
stormgtm unarchive <thread-id>
stormgtm spam <thread-id>
stormgtm unspam <thread-id>
stormgtm counts
stormgtm me
```

Radar (beta) finds people to email from a website or a description of your ideal customer:

```bash
stormgtm radar acme.io                       # progress on stderr, one lead per line on stdout, then a summary
stormgtm radar "CTOs at seed-stage dev tools startups" --chat <chat-id> --json
stormgtm leads [--chat <chat-id>]            # leads Radar saved, with verdicts once qualified
stormgtm qualify-leads <lead-id> <lead-id> [--deep]
```

`radar` costs 1 credit per new lead with an email; searches that find nobody are free, and it exits 2 when it finds nobody. A search can take a minute or two. Qualify the leads before you send to them.

`reply` answers an existing thread only, goes to the thread's participant and costs 1 credit. In a terminal it asks before sending; pass `--yes` to skip the question.

`check` exits 2 when the lead is undeliverable, so it drops into shell pipelines.

| Exit code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Error (API or network) |
| 2 | Lead undeliverable, nothing was sent or enrolled, or Radar found no leads |
| 3 | Usage error |
| 4 | Not enough credits |
| 6 | Not logged in, or the API key was rejected |
| 7 | Rate limited |
 Add `--json` to any command for machine-readable output. CSV files for `batch` need an `email` column; `name`, `company`, `companyDomain`, `title`, `githubLogin` and other context columns are passed along.

## Agent skills

```bash
stormgtm skill install --claude
stormgtm skill install --cursor --agents --json
```

Writes the `stormgtm-gtm` and `stormgtm-send` skills into `.claude/skills/`, `.cursor/skills/` and/or `.agents/skills/` of the current project (the git toplevel, else the current directory). Existing copies are overwritten; the command refuses to write through symlinks.

## Library

```ts
import { StormGTM, clientFromEnv } from "stormgtm";

const stormgtm = clientFromEnv();
const result = await stormgtm.check({ email: "jane@acme.io", context: { company: "Acme" } });
if (result.verdict === "deliverable" && result.policy.allowed) {
  await stormgtm.send({ from: "Ada <ada@mail.acme.io>", to: "jane@acme.io", subject: "Hello", text: "Hi Jane" });
}
await stormgtm.reportOutcome({ email: "jane@acme.io", kind: "delivered" });
```

`clientFromEnv()` reads the environment, then `~/.stormgtm/config.json`.

Inbox:

```ts
const { threads, nextCursor } = await stormgtm.threads({ folder: "inbox", unread: true, q: "pricing" });
const thread = await stormgtm.thread(threads[0].id);
await stormgtm.reply(thread.id, { text: "Thanks, here is the pricing.", idempotencyKey: `reply-${thread.id}` });
await stormgtm.markRead([thread.id]);
await stormgtm.archiveThreads([thread.id]);
await stormgtm.spamThreads([thread.id]);
const counts = await stormgtm.inboxCounts();
```

Radar:

```ts
const { chatId, answer, leads } = await stormgtm.findLeads({
  content: "acme.io",
  onEvent: (event) => {
    if (event.type === "tool" && event.phase === "start") console.error(event.summary);
  },
});
const { leads: checked } = await stormgtm.qualifyRadarLeads(leads.map((lead) => lead.id));
const deliverable = checked.filter((lead) => lead.verdict === "deliverable");
```

`findLeads` creates a chat unless you pass `chatId`, streams the search and resolves when it finishes. It throws `StormGTMError` on an API error (for example `insufficient_credits`) or when the search fails. `radarChats`, `createRadarChat`, `radarMessages`, `radarLeads`, `deleteRadarLead` and `cancelRadarChat` cover the rest of the Radar API.

## MCP server

See [stormgtm-mcp](https://www.npmjs.com/package/stormgtm-mcp): `claude mcp add stormgtm -- npx -y stormgtm-mcp`.

## Source

Public source (MIT): [github.com/marginsystems/stormgtm-cli](https://github.com/marginsystems/stormgtm-cli). Tags match npm versions.

```bash
git clone https://github.com/marginsystems/stormgtm-cli.git
cd stormgtm-cli
npm install
npm run build
node dist/cli.js --help
```
