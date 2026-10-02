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
stormgtm me
```

`check` exits 2 when the lead is undeliverable, so it drops into shell pipelines.

| Exit code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Error (API or network) |
| 2 | Lead undeliverable, or nothing was sent or enrolled |
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
