# Codex Atlas

**Show your recorded AI usage on your GitHub profile.** Self-host your stats card, run an automatic collector on your computer, and paste one image link into your profile README. Includes a private dashboard for exploring your stats.

Open `/share` on your instance for the deploy button generator, card preview, metric choices, and copyable README Markdown. Each developer hosts their own instance; no shared account service is required.

A Next.js dashboard for your **recorded Codex, Claude Code, and Cursor usage**, with a provider switch and separate data for each: token totals by model, a contribution calendar, model share, daily trends, input/output distribution, and activity by hour. It reads real retained provider history; it does not ship invented usage.

The Codex view is useful for a personal Pro subscription. Claude Code works from retained local logs without assuming which subscription or billing plan you use. Cursor coverage depends on the usage records or exports supplied to its collector; it is not inferred from chat text. This is not an OpenAI, Anthropic, or Cursor billing or account-lifetime API. Deleted history, other devices, and cloud-only sessions may be missing. The first and last observed dates describe available coverage, not your account creation date.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000) for Codex, [localhost:3000/claude](http://localhost:3000/claude) for Claude Code, or [localhost:3000/cursor](http://localhost:3000/cursor) for Cursor; the sidebar switches providers. Local Codex mode reads `~/.codex/sessions` and `~/.codex/archived_sessions`, including nested folders and both plain `.jsonl` and Zstandard-compressed `.jsonl.zst` rollouts. Set `CODEX_HOME` to use another retained history directory. The app automatically collects local usage; dashboard refreshes display new data. `USAGE_TIMEZONE` defaults to `Australia/Sydney`.

Claude Code reads `~/.claude/projects` recursively, including project session files and nested subagent logs. `CLAUDE_HOME` overrides the `~/.claude` root containing `projects/`; it does not point at an individual project. No history produces an empty state rather than sample usage.

Cursor token and model graphs use **Cursor Usage events CSV exports**. Set `CURSOR_USAGE_CSV` to one export file, or place CSV exports in `CURSOR_USAGE_DIR` (default `data/cursor-imports`). For example, copy an export into that ignored directory and select Cursor in the dashboard. The collector uses the selected CSV source by itself; it does not mix a dated export with unrelated local conversation activity. New account activity appears after you export updated usage data and replace or add an import. Live dashboard polling and sync watch the available files; they do not sign into Cursor or download account data.

Without CSV exports, Cursor shows available local conversation/session activity from read-only metadata in its global SQLite database. `CURSOR_DB_PATH` optionally selects another Cursor global `state.vscdb`. Local placeholder/context token counters cannot establish token usage, cache breakdown, API value or model-call totals, so those metrics show unavailable. No account credentials or prompts are read into snapshots. CSV exports without conversation IDs cannot establish sessions or average tokens per session; usage events also cannot distinguish human prompts from internal model calls.

CSV input, cache-write, cache-read and output buckets are reconciled against each row's total. The exported `Cost` text is not treated as a paid amount. Errored or not-charged events can still contain token counts and contribute to recorded API-equivalent activity. Auto and unknown models remain unpriced; current published replacement prices are separate from historical Cursor bills. See [`CURSOR-AUDIT.md`](CURSOR-AUDIT.md) for source limitations and independent reconciliation.


Both CLI commands load `.env.local`, then `.env`, without overriding variables already supplied by the shell. To save a private aggregate snapshot manually:

```sh
npm run collect
# One provider, or all three independently
npm run collect -- --provider claude
npm run collect -- --provider cursor
npm run collect -- --provider all
```

Codex writes `data/snapshot.json`, Claude writes `data/claude-snapshot.json`, and Cursor writes `data/cursor-snapshot.json`, each with owner-only file permissions. `--provider` accepts `codex`, `claude`, `cursor`, or `all`; space and equals syntax both work. No-argument commands still select Codex, and `all` attempts all three independently; unknown flags and providers are rejected. `data/`, environment files, and build output are ignored by Git. It contains aggregate usage, not transcripts, but it is still personal information. Do not commit it. Never upload `.codex/auth.json`, Claude credential files, cookies, raw rollouts, or the whole `.codex` / `.claude` directory.

## What the numbers mean

| Metric | Definition |
| --- | --- |
| Tokens | Recorded input plus output. Claude ordinary input, cache-read input, and cache-write input are normalized into the total input figure. Cache read/write are subsets of input; reasoning is a subset of output. They are not added twice. |
| Models | Attribution from recorded model context. Unknown models remain visible and unpriced. |
| API-equivalent value | Current published USD token rates applied to recorded usage, including available cache and speed data. This is replacement value, not a subscription bill or historical charges. |
| Sessions | Unique recorded threads with token usage or a root user message. Subagents with usage count as sessions. |
| Human requests | Best-effort root-chat user messages, excluding context metadata where available. Older records can include automated prompts. This differs from the number of model responses. |
| Average tokens/session | Total recorded tokens divided by the same session count. |
| Most expensive 24 hours | Highest known cost in a rolling `(start, end]` 24-hour window. Unpriced models cannot contribute a known cost. |

The importer streams plain and compressed rollouts, prefers current per-response token records, deduplicates response IDs, and uses differences between legacy cumulative counters. Forked logs retain their first physical session header so inherited parent metadata cannot overwrite child identity. Unchanged files reuse an in-memory parsed cache keyed by path, size, and modification time; that cache contains normalized usage records and deduplication keys, never transcript rows. Changed files are reparsed and deleted files leave the cache. A session with modern records suppresses legacy records for that session; mixed-format historical segments can be omitted. Malformed or unfinished lines are skipped and reported. Codex's local schemas are private implementation details and can change.

Pricing and source URLs live in [`lib/pricing.ts`](lib/pricing.ts), with supporting findings in [`research.md`](research.md). Rates are dated; update and review them when prices change. Missing speed metadata defaults to Standard. Tool and regional charges are excluded. Unknown prices are not silently guessed. This dashboard does not calculate subscription allowance percentages. Claude uses its own model rates and cache semantics; see the Claude research notes and pricing entries for coverage and dated sources. Cache-write input is priced separately from cache reads. Unknown Claude model prices stay unpriced.

## Cloud deployment

The dashboard can run independently in the cloud. New local activity still needs a collector running on the machine that has that history:

```text
Provider history / usage export → local collector → authenticated HTTPS upload → cloud Redis → dashboard
```

The upload contains daily/model/hour aggregates and coverage metadata. It does not contain prompts, responses, project paths, session IDs, or account credentials. A single upload replaces the previous snapshot for its provider; **use one collector per provider only**. Each provider has isolated storage, so syncing Cursor or Claude never overwrites Codex. Multiple machines are not merged, and concurrent collectors can replace each other's coverage.

### Vercel

1. Import this Next.js project into Vercel. No custom build command is required.
2. Create an Upstash Redis database and set these deployment environment variables:
   - `ATLAS_MODE=cloud`
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   - `SYNC_TOKEN`, a unique random value of at least 32 characters
   - `DASHBOARD_PASSWORD`, a separate strong dashboard password
   - `PUBLIC_WIDGET=false`, `PUBLIC_CLAUDE_WIDGET=false`, and `PUBLIC_CURSOR_WIDGET=false` unless you explicitly want the corresponding public badge
3. Deploy. Sign in with `DASHBOARD_PASSWORD`. Before the first sync, an empty state is expected.
4. On your local collector machine, keep `ATLAS_MODE=local` and set `SYNC_URL` to the deployed dashboard origin and `SYNC_TOKEN` to the same ingestion secret. The collector needs no Redis credential and no dashboard password.
5. Run:

```sh
npm run sync
# Continuously collect, upload, then wait 30 seconds; Ctrl+C stops.
npm run sync -- --watch
# Upload one provider, or watch all three providers
npm run sync -- --provider claude
npm run sync -- --provider cursor
npm run sync -- --provider all --watch
```

Sync requires HTTPS, except loopback HTTP for development. Redirects are rejected. Keep secrets in environment files or a secret manager, never command arguments. Do not use `NEXT_PUBLIC_` variables for secrets. You can generate a secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

The watch process must remain running, or be supervised by your operating system's service manager. When the collector is offline, the cloud keeps the last durable snapshot and shows its age. Cloud hosting cannot fetch personal provider account history on its own. Polling an exported file only updates the dashboard when that source file changes; it does not automatically refresh the provider account export. With `--provider all`, providers are attempted separately; a failure in one is reported and does not prevent an upload attempt for the other. A one-off sync exits unsuccessfully if any selected provider fails. Watch mode retries on the next cycle. This repository provides the deployment implementation; creating a real cloud deployment requires your hosting and Redis configuration.

### Docker

```sh
docker build -t codex-atlas .
docker run --rm -p 3000:3000 --env-file .env.cloud codex-atlas
```

Create `.env.cloud` with the cloud deployment variables above. Put the container behind an HTTPS host or reverse proxy. The Docker image excludes local data and `.env` files and runs as an unprivileged user. Local production mode also requires `DASHBOARD_PASSWORD`; cloud mode is the intended container deployment because a container cannot see your laptop history without an explicit mount.

## GitHub profile cards

1. Fork this repository and clone your fork. Requires Node.js 24 and npm.
2. Create an Upstash Redis database. Deploy the fork to Vercel using the settings in **Cloud deployment** above. Alternatively, open `/share` locally and enter your fork's GitHub URL to generate a **Deploy to Vercel** button. The setup page asks for your fork's actual repository URL.
3. On the server, explicitly enable the providers you want public: `PUBLIC_WIDGET=true` (Codex), `PUBLIC_CLAUDE_WIDGET=true` (Claude Code), or `PUBLIC_CURSOR_WIDGET=true` (Cursor). Keep other flags `false`, and redeploy after changes.
4. On your computer, put `ATLAS_MODE=local`, `SYNC_URL=https://your-instance.vercel.app`, and the matching `SYNC_TOKEN` in `.env.local`. The collector does not need Redis credentials or the dashboard password. Run `npm ci`, then `npm run sync -- --provider all` and confirm successful uploads.
5. Install the automatic collector using the commands below.
6. Open **GitHub profile** in the dashboard, or go to `/share`. Choose a provider, theme, and metrics, then enter your public deployment URL and copy the Markdown. Paste it into the `README.md` of a public GitHub repository named exactly like your GitHub username.

Example embeds (replace the domain with your deployment):

```md
![My recorded Codex usage](https://your-instance.vercel.app/api/card?provider=codex&theme=dark&metrics=tokens,sessions)
![My recorded Claude Code usage](https://your-instance.vercel.app/api/card?provider=claude&theme=light&metrics=tokens,requests)
![My recorded Cursor usage](https://your-instance.vercel.app/api/card?provider=cursor&theme=dark&metrics=tokens,sessions)
```

The `/api/card` endpoint returns an accessible SVG with a light or dark theme, one to three metrics (`tokens`, `sessions`, `requests`), and a collection timestamp in UTC. `requests` means recorded human requests. Missing metrics show **Unavailable**, not zero. It reads the latest stored aggregate snapshot; it does not read local history on demand. Local previews require `npm run collect -- --provider all` plus the desired public flags. Existing `/api/widget` badge links keep working with the same opt-ins.

**Sharing is opt-in per provider.** Enabling a provider allows anyone to request any of its supported public summary metrics through either public endpoint. The metric selector customizes the card layout; it is not an access control. Cards never include API-equivalent cost, conversation text, model names, project paths, session identifiers, or credentials. Detailed dashboard endpoints still require the dashboard password. Never put a password or `SYNC_TOKEN` in a README URL.

The collector waits 30 seconds after each upload cycle. The dashboard refreshes every 15 seconds. Card responses can be cached for five minutes; [GitHub's image proxy](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls) can delay profile updates further. This is automatic updating, not a guaranteed live feed. Disabling a public flag stops new endpoint reads once deployment settings take effect, but cannot erase copies already cached or saved by others.

### Automatic local collector

On macOS or Linux with a user systemd session:

```sh
npm run collector:install -- --provider all
npm run collector:status
npm run collector:uninstall
```

Use `--provider codex`, `--provider claude`, or `--provider cursor` to sync only one provider; the default is Codex. Install one service per user, from one stable checkout. Reinstalling updates that service. Use one collector per provider: snapshots from different computers are **not merged**.

The installer reads `SYNC_URL` and `SYNC_TOKEN` from this checkout's `.env.local`, restricts that file to owner-only permissions, and registers a service that starts at login and restarts after a crash. Secrets remain in `.env.local`, not in the service definition or command arguments. Keep the checkout, Node.js installation, and dependencies at their installed paths; reinstall the service after moving them. The service runs while your user session is active. A Linux user service needs systemd available; running after logout additionally depends on the host's user-session configuration.

macOS uses `~/Library/LaunchAgents/dev.codex-atlas.collector.plist`, with logs in `~/Library/Logs/CodexAtlas/`. Linux uses `~/.config/systemd/user/dev.codex-atlas.collector.service`, with logs available through `journalctl --user -u dev.codex-atlas.collector.service`. Status reports the service process; verify the cloud collection timestamp to confirm successful uploads. Uninstall stops the service and removes its definition, keeping your settings, logs, and snapshots.

On Windows, run `npm run sync -- --provider all --watch` in a terminal or your preferred process supervisor; this installer does not configure Windows startup. On every platform, the computer holding the source data must be awake and online. An exported provider file updates only when that export itself changes.

## Open source

Licensed under [MIT](LICENSE). Contributions should pass the validation commands below and keep raw provider history and credentials local. `.gitignore`, `.dockerignore`, `.vercelignore`, and Next.js tracing exclusions keep local data and environment files out of normal source/deployment uploads. Review files and any existing Git history before making your fork public.

## Validation and maintenance

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

Tests cover token parsing and deduplication, aggregate calculations, pricing, and authentication boundaries. Build and local tests do not prove that your hosting credentials or remote deployment work. After deploying, verify login, a collector upload, a reload with matching totals, and the freshness timestamp. Rotate both secrets if exposed. Delete Redis key `codex-atlas:snapshot:v1` for Codex, `claude-atlas:snapshot:v1` for Claude, or `cursor-atlas:snapshot:v1` for Cursor to remove the respective cloud snapshot; remove local `data/snapshot.json`, `data/claude-snapshot.json`, or `data/cursor-snapshot.json` separately. Existing v1 snapshots without a provider field remain Codex. Usage, ingestion, and widget endpoints default to Codex; `?provider=claude` selects Claude and `?provider=cursor` selects Cursor, and ingestion rejects a provider mismatch. Your Redis provider's backups and retention settings apply independently.
# vibe-check
