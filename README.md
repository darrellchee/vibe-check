# Codex Atlas

**Show your recorded AI usage on your GitHub profile.** Self-host your stats card, run an automatic collector on your computer, and paste one image link into your profile README. Includes a private dashboard for exploring your stats.

Open `/share` on your instance for the deploy button generator, card preview, metric choices, and copyable README Markdown. Open `/edit` for the drag-and-drop README Editor. Each developer hosts their own instance; no shared account service is required.

A Next.js dashboard for your **recorded Codex, Claude Code, Cursor, and Antigravity usage**, with a provider switch and separate data for each: token totals by model, a contribution calendar, model share, daily trends, input/output distribution, and activity by hour. It reads real retained provider history; it does not ship invented usage.

The Codex view is useful for a personal Pro subscription. Claude Code works from retained local logs without assuming which subscription or billing plan you use. Cursor coverage depends on the usage records or exports supplied to its collector; it is not inferred from chat text. This is not an OpenAI, Anthropic, or Cursor billing or account-lifetime API. Deleted history, other devices, and cloud-only sessions may be missing. The first and last observed dates describe available coverage, not your account creation date.

## Get started in two steps

1. **Deploy.** [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdarrellchee%2Fvibe-check&project-name=vibe-check&repository-name=vibe-check&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%7D%5D) Vercel copies the repo to your GitHub and creates a free Upstash Redis database. There are no environment variables to fill in.
2. **Claim and connect.** Open your new site and press **Claim this dashboard**. It generates your password (shown once) and gives you one command to paste into a terminal on the computer with your usage history:

   ```sh
   curl -fsSL https://your-site.vercel.app/api/install | sh -s -- <one-time-code>
   ```

   The command installs the collector, links it to your dashboard and starts it at login (macOS or Linux, Node.js 24 and git required). Your profile cards are public by default, and the page shows the Markdown to paste into your GitHub profile README.

Claim your site right after deploying: the first visitor to press the button owns it, and it can only be claimed once. If someone else claimed it first, delete the project and deploy again. The one-time code works once and expires after 15 minutes; the claimed site can create more from `/setup` while signed in. Read the installer first with `curl -fsSL https://your-site.vercel.app/api/install`. It clones this repository, runs `npm ci`, redeems the code for a per-computer upload token, writes it to `.env.local` with owner-only permissions, and runs `npm run collector:install`.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000) for Codex, [localhost:3000/claude](http://localhost:3000/claude) for Claude Code, [localhost:3000/cursor](http://localhost:3000/cursor) for Cursor, or [localhost:3000/antigravity](http://localhost:3000/antigravity) for Antigravity; the sidebar switches providers. Local Codex mode reads `~/.codex/sessions` and `~/.codex/archived_sessions`, including nested folders and both plain `.jsonl` and Zstandard-compressed `.jsonl.zst` rollouts. Set `CODEX_HOME` to use another retained history directory. The app automatically collects local usage; dashboard refreshes display new data. `USAGE_TIMEZONE` defaults to `Australia/Sydney`.

Claude Code reads `~/.claude/projects` recursively, including project session files and nested subagent logs. `CLAUDE_HOME` overrides the `~/.claude` root containing `projects/`; it does not point at an individual project. No history produces an empty state rather than sample usage.

**History ledger.** Claude Code's transcripts are the only record of Claude Code usage, and Claude Code deletes them after `cleanupPeriodDays` (default **30**). To keep your history, the collector appends each message's token counts to a private, append-only ledger, `data/claude-ledger-<id>.jsonl`, and merges it back in, so usage survives transcript cleanup. The ledger holds only one-way hashed IDs, timestamps, model names and token counts: never prompts, responses, project paths or raw IDs. It is owner-only, ignored by Git, and never uploaded, though it is still personal usage data. It can only keep what the collector has seen, so history Claude Code deleted before the ledger began cannot be recovered; also set `"cleanupPeriodDays": 3650` in `~/.claude/settings.json` so Claude Code stops deleting transcripts. `CLAUDE_LEDGER=false` turns the ledger off, and `CLAUDE_LEDGER_PATH` chooses a different file (needed to use a ledger with an explicitly passed home in scripts).

Cursor token, model and cost graphs come from your usage events. Set `CURSOR_AUTO_SYNC=true` to have the collector fetch them automatically from your Cursor account, with no manual exports (see below). Otherwise, supply **Cursor Usage events CSV exports**: set `CURSOR_USAGE_CSV` to one export file, or place CSV exports in `CURSOR_USAGE_DIR` (default `data/cursor-imports`). Sessions, human requests and the activity calendar always come from read-only metadata in Cursor's local database, across all retained history, even when token data covers a shorter range. Account sync and CSV imports can be combined: synced events are authoritative for the dates they cover, and imported rows are kept only for earlier dates.

**Automatic sync (opt-in).** With `CURSOR_AUTO_SYNC=true`, the collector reads the access token saved by the Cursor desktop app (one key in its local database), then calls Cursor's dashboard usage-events endpoint, `cursor.com/api/dashboard/get-filtered-usage-events`, read-only and at most every ten minutes, to fetch your own usage events. The token is held in memory for the request: it is never logged, written to disk, included in a snapshot or uploaded, and redirects are refused so it cannot be forwarded. That endpoint is **undocumented and unofficial**, so Cursor can change or block it without notice; if it fails (signed out, expired login, changed format), the dashboard falls back to local and imported data and shows a warning. Cursor's official Analytics and Admin APIs are team/enterprise only and are not used. The API only returns events Cursor has retained (for one account, from July 2025); earlier history needs a CSV export if Cursor still offers one. Leave `CURSOR_AUTO_SYNC` unset and no account credentials are read.

Without account sync or CSV exports, Cursor shows available local conversation/session activity from read-only metadata in its global SQLite database. `CURSOR_DB_PATH` optionally selects another Cursor global `state.vscdb`. Local placeholder/context token counters cannot establish token usage, cache breakdown, API value or model-call totals, so those metrics show unavailable. No prompts are read into snapshots. Usage events cannot distinguish human prompts from internal model calls, so human requests and sessions come from local conversation metadata.

Token buckets (input, cache-write, cache-read, output) are reconciled against each CSV row's total, and synced events were verified field-for-field against a CSV export of the same period. The exported `Cost` text is not treated as a paid amount. Errored or not-charged events can still contain token counts and contribute to recorded API-equivalent activity. Costs use current published prices; where none exists (Auto, Composer and other routed models) a synced event uses the cost Cursor reports for it, and CSV-only rows for those models stay unpriced. These are API-equivalent values, separate from historical Cursor bills. See [`CURSOR-AUDIT.md`](CURSOR-AUDIT.md) for source limitations and independent reconciliation.


Antigravity reads its local conversation databases (`conversations/*.db` under `~/.gemini/antigravity` and `~/.gemini/antigravity-cli`) strictly read-only; set `ANTIGRAVITY_HOME` to use a different parent than `~/.gemini`. Every recorded model call carries uncached input, cache-read, output and thinking tokens, and the dashboard reads those directly: nothing is estimated. One conversation is one session, and human requests are user-input steps. Cache-write tokens, billed amounts and plan quota are not recorded, so they are shown as unavailable. Antigravity is a plan and quota product, so API-equivalent USD is a replacement-cost estimate, not a bill. Gemini Flash and Claude Opus 4.6 are priced; a model with no known price stays unpriced and is counted in the unpriced-token total instead of being guessed. Google lists the Gemini 3.6 and 3.8 Flash prices through 2026-12-31 and doubles them from 2027-01-01, so dollar figures re-base when published rates change; update `lib/antigravity-pricing.ts` when Google changes them. Background context-compaction calls (about 0.5% of tokens) and legacy encrypted conversations cannot be read. The token layout is reverse-engineered from private, unversioned data and may change with an app update, so the collector checks its invariants and reports warnings. See [`ANTIGRAVITY-RESEARCH.md`](ANTIGRAVITY-RESEARCH.md) for the field map and sources.

Both CLI commands load `.env.local`, then `.env`, without overriding variables already supplied by the shell. To save a private aggregate snapshot manually:

```sh
npm run collect
# One provider, or all four independently
npm run collect -- --provider claude
npm run collect -- --provider cursor
npm run collect -- --provider antigravity
npm run collect -- --provider all
```

Codex writes `data/snapshot.json`, Claude writes `data/claude-snapshot.json`, Cursor writes `data/cursor-snapshot.json`, and Antigravity writes `data/antigravity-snapshot.json`, each with owner-only file permissions. `--provider` accepts `codex`, `claude`, `cursor`, `antigravity`, or `all`; space and equals syntax both work. No-argument commands still select Codex, and `all` attempts all four independently; unknown flags and providers are rejected. `data/`, environment files, and build output are ignored by Git. It contains aggregate usage, not transcripts, but it is still personal information. Do not commit it. Never upload `.codex/auth.json`, Claude credential files, cookies, raw rollouts, or the whole `.codex` / `.claude` directory.

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

Use the deploy button in **Get started** for the zero-configuration path. A site running on Vercel switches to cloud mode automatically, accepts both `UPSTASH_REDIS_REST_*` and Vercel's `KV_REST_API_*` variable names, and stores only hashes of its generated password and upload tokens.

**Advanced: operator-managed secrets.** Environment variables still take precedence over generated credentials, which suits teams, containers and scripted deploys:

- `ATLAS_MODE=cloud` (optional on Vercel)
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `SYNC_TOKEN`, a unique random value of at least 32 characters
- `DASHBOARD_PASSWORD`, a separate strong dashboard password
- `PUBLIC_WIDGET`, `PUBLIC_CLAUDE_WIDGET`, `PUBLIC_CURSOR_WIDGET` and `PUBLIC_ANTIGRAVITY_WIDGET` set to `true` or `false`. Unset means a claimed site publishes that provider's card; `false` keeps it private.

With `DASHBOARD_PASSWORD` set, the claim page is disabled. On the collector computer keep `ATLAS_MODE=local`, set `SYNC_URL` to the deployed origin and `SYNC_TOKEN` to the same secret, then run:

```sh
npm run sync
# Continuously collect, upload, then wait 30 seconds; Ctrl+C stops.
npm run sync -- --watch
# Upload one provider, or watch all four providers
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

1. Deploy and claim your site, then run the connect command (see **Get started**).
2. Open `/setup` right after claiming, or `/share` any time. Pick a provider, theme and metrics and copy the Markdown.
3. Paste it into the `README.md` of a public GitHub repository named exactly like your GitHub username.

Cards are public by default on a claimed site, for every provider including ones added later. To keep one private, set its `PUBLIC_*_WIDGET` variable to `false` and redeploy.

Example embeds (replace the domain with your deployment):

```md
![My recorded Codex usage](https://your-instance.vercel.app/api/card?provider=codex&theme=dark&metrics=tokens,sessions)
![My recorded Claude Code usage](https://your-instance.vercel.app/api/card?provider=claude&theme=light&metrics=tokens,requests)
![My recorded Cursor usage](https://your-instance.vercel.app/api/card?provider=cursor&theme=dark&metrics=tokens,sessions)
```

The `/api/card` endpoint returns an accessible SVG with a light or dark theme, one to three metrics (`tokens`, `sessions`, `requests`), and a collection timestamp in UTC. `requests` means recorded human requests. Missing metrics show **Unavailable**, not zero. It reads the latest stored aggregate snapshot; it does not read local history on demand. Local previews require `npm run collect -- --provider all` plus the desired public flags. Existing `/api/widget` badge links keep working with the same opt-ins.

**Sharing is controlled per provider.** A public provider allows anyone to request any of its supported public summary metrics through either public endpoint. The metric selector customizes the card layout; it is not an access control. Cards never include API-equivalent cost, conversation text, model names, project paths, session identifiers, or credentials. Detailed dashboard endpoints still require the dashboard password. Never put a password or `SYNC_TOKEN` in a README URL.

The collector waits 30 seconds after each upload cycle. The dashboard refreshes every 15 seconds. Card responses can be cached for five minutes; [GitHub's image proxy](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls) can delay profile updates further. This is automatic updating, not a guaranteed live feed. Setting a flag to `false` stops new endpoint reads once deployment settings take effect, but cannot erase copies already cached or saved by others.

### README Editor

Open `/edit` (the **Edit** entry in the nav bar) to build a whole profile README instead of pasting one card. Drag elements from the board onto the README (a usage card, an activity calendar, or text blocks), then switch between **Edit** and **Preview**. Every thumbnail on the board is that card drawn with your own usage (or labelled sample data where a provider has none yet), and the board can be filtered by provider.

**Presets and styles.** Each provider has ready-made presets: usage cards in *Classic*, *Compact*, *Spotlight* and *Light* looks, and calendars in *Classic*, *Compact* and *Light*. Every card then has its own **Theme**, **Style** and **Accent** (lime, orange, blue, violet or mono) controls. Provider presets use that provider's dashboard colour.

**Size and layout.** Drag the blue handle on a card's right edge to resize it (or use its **Width** slider, 200 to 800 px). To put cards side by side, drop one on the left or right quarter of another, or press **Beside previous**; **Own row** takes a card back out. Cards that would not fit in a README-wide row (800 px) shrink to equal shares. Cards you have not resized and left on their own rows stay plain Markdown images; resized or side-by-side cards are written as `<img width="…">` tags in one `<p>`, which GitHub keeps and wraps on narrow screens. The preview uses your private dashboard data; it loads when you open the page and when you press refresh, and does not update on its own. When you are done, copy the Markdown or download it as `README.md`.

The draft is stored only in your browser's `localStorage`; the server never receives it. The generated image links need your public HTTPS dashboard URL, so enter it in the editor's URL field (or press **Use this website's URL** when you are on the deployed site). Origins GitHub could not load are rejected with a message instead of producing broken images: non-HTTPS addresses, anything with a path, query, hash or credentials, `localhost` and `*.localhost`, `*.local` and `*.internal` names, single-word hosts, IPv6 literals, and IPv4 addresses in loopback, private, link-local or carrier-grade NAT ranges (a public IPv4 address is accepted). Text such as `atlas.example` without `https://` gets a hint to enter a full address. The draft, including that URL, stays in the browser.

### Card parameters

`/api/card` accepts these query parameters:

| Parameter | Values | Notes |
| --- | --- | --- |
| `kind` | `usage` (default), `calendar` | `usage` is the summary card. `calendar` is a 12-month activity heatmap. |
| `provider` | `codex` (default), `claude`, `cursor`, `antigravity` | Each provider is shared separately. |
| `theme` | `dark` (default), `light` | |
| `metrics` | one to three of `tokens`, `sessions`, `requests` | Shapes `kind=usage` cards. For `kind=calendar` it is still validated (an invalid value returns `400`) but otherwise ignored. |
| `style` | `classic` (default), `compact`, `spotlight` | Layout. `compact` is a slim row (a calendar without its footer); `spotlight` makes the first metric a hero number and is for `kind=usage` only (`kind=calendar&style=spotlight` returns `400`). |
| `accent` | `lime` (default), `orange`, `blue`, `violet`, `mono` | Colour only. The defaults reproduce the original card exactly, and the editor leaves default values out of the URL. |

Repeated or unknown values return `400`, and a provider whose card is disabled returns `404`.

```md
![My recorded Codex activity](https://your-instance.vercel.app/api/card?kind=calendar&provider=codex&theme=dark)
![My recorded Claude Code usage](https://your-instance.vercel.app/api/card?provider=claude&theme=dark&metrics=tokens,sessions,requests&style=compact&accent=orange)
```

**Calendar measure.** A calendar is scaled by recorded tokens. Cursor is the exception: its token data only covers the exported or synced date range, so its calendar uses human requests whenever those are recorded (as the dashboard's calendar does), and falls back to tokens otherwise. Other providers fall back to human requests only when they cannot report tokens. Impossible dates, and rows dated more than a day after the snapshot, are ignored.

**Calendar privacy.** A calendar publishes per-day intensity levels (five levels) for the last 12 months, plus a total and an active-day count. It has no model names and no exact daily numbers, but anyone can infer which days were active and how busy each day was relative to the others. There is no separate calendar opt-in: calendars are public whenever that provider's card is enabled (`PUBLIC_*_WIDGET`), so anyone with the link can request them.

### Automatic local collector

On macOS or Linux with a user systemd session:

```sh
npm run collector:install -- --provider all
npm run collector:status
npm run collector:uninstall
```

Use `--provider codex`, `--provider claude`, `--provider cursor`, or `--provider antigravity` to sync only one provider; the default is Codex. Install one service per user, from one stable checkout. Reinstalling updates that service. Use one collector per provider: snapshots from different computers are **not merged**.

The installer (run for you by the connect command) reads `SYNC_URL` and `SYNC_TOKEN` from this checkout's `.env.local`, restricts that file to owner-only permissions, and registers a service that starts at login and restarts after a crash. Secrets remain in `.env.local`, not in the service definition or command arguments. Keep the checkout, Node.js installation, and dependencies at their installed paths; reinstall the service after moving them. The service runs while your user session is active. A Linux user service needs systemd available; running after logout additionally depends on the host's user-session configuration.

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
