import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createGunzip, createZstdDecompress } from "node:zlib";
import { readJsonLines } from "./jsonl";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  estimateClaudeCost,
  CLAUDE_PRICING_CHECKED_AT,
  CLAUDE_PRICING_SOURCES,
} from "./claude-pricing";
import {
  appendLedger,
  loadLedger,
  mergeEvent,
  type ClaudeEvent as Event,
  type ClaudeHuman as Human,
} from "./claude-ledger";
import type {
  DailyUsage,
  ModelUsage,
  TokenTotals,
  UsageSnapshot,
} from "./types";

type Obj = Record<string, unknown>;
type Parsed = {
  events: Map<string, Event>;
  humans: Map<string, Human>;
  malformed: number;
  missingTtl: number;
};
const cache = new Map<
  string,
  { size: number; mtime: number; parsed: Parsed }
>();
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const text = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const zero = (): TokenTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});
const tokenKeys = Object.keys(zero()) as (keyof TokenTotals)[];
const add = (target: TokenTotals, value: TokenTotals) => {
  for (const key of tokenKeys) target[key] += value[key];
};
async function inventory(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const groups = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? inventory(path.join(dir, e.name))
        : e.isFile() && /\.jsonl(?:\.zst|\.gz)?$/.test(e.name)
          ? [path.join(dir, e.name)]
          : [],
    ),
  );
  return groups.flat().sort();
}
function defaultDesktopHome() {
  if (process.platform === "darwin")
    return path.join(homedir(), "Library", "Application Support", "Claude");
  if (process.platform === "win32")
    return path.join(
      process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"),
      "Claude",
    );
  return path.join(homedir(), ".config", "Claude");
}
// The Claude desktop app runs each agent-mode (Cowork) session against its own
// private config dir: <desktop>/local-agent-mode-sessions/<org>/<user>/local_<id>/.claude.
// Their transcripts never reach ~/.claude/projects, so they must be scanned separately.
async function desktopProjectDirs(desktopHome: string): Promise<string[]> {
  const subdirs = async (dir: string) => {
    try {
      return (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name));
    } catch {
      return [];
    }
  };
  let level = [path.join(desktopHome, "local-agent-mode-sessions")];
  for (let depth = 0; depth < 3; depth++)
    level = (await Promise.all(level.map(subdirs))).flat();
  return level.map((session) => path.join(session, ".claude", "projects"));
}
async function parseFile(file: string): Promise<Parsed> {
  const metadata = await stat(file),
    cached = cache.get(file);
  if (
    cached &&
    cached.size === metadata.size &&
    cached.mtime === metadata.mtimeMs
  )
    return cached.parsed;
  const parsed: Parsed = {
    events: new Map(),
    humans: new Map(),
    malformed: 0,
    missingTtl: 0,
  };
  const base = path.basename(file).replace(/\.jsonl(?:\.zst|\.gz)?$/, "");
  const subagent =
    file.split(path.sep).includes("subagents") || base.startsWith("agent-");
  const source = createReadStream(file);
  const input = file.endsWith(".zst")
    ? source.pipe(createZstdDecompress())
    : file.endsWith(".gz")
      ? source.pipe(createGunzip())
      : source;
  source.on("error", (error) => input.destroy(error));
  const lines = readJsonLines(input);
  try {
    for await (const line of lines) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(line);
      } catch {
        parsed.malformed++;
        continue;
      }
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
        parsed.malformed++;
        continue;
      }
      const row = obj(decoded),
        message = obj(row.message);
      const originalTime = text(row.timestamp);
      if (!originalTime || !Number.isFinite(Date.parse(originalTime))) continue;
      const timestamp = new Date(originalTime).toISOString();
      const root = text(row.sessionId) || base;
      const sidechain = subagent || row.isSidechain === true;
      const agent = text(row.agentId) || base;
      const session = sidechain ? `${root}:agent:${agent}` : root;
      if (row.type === "assistant") {
        const usage = obj(message.usage);
        const candidateModel = text(message.model);
        if (candidateModel === "<synthetic>") continue;
        const rawModel =
          candidateModel && /^[a-zA-Z0-9._:/-]{1,100}$/.test(candidateModel)
            ? candidateModel
            : "unknown";
        if (!Object.keys(usage).length) continue;
        const cachedInputTokens = num(usage.cache_read_input_tokens),
          cacheWriteTokens = num(usage.cache_creation_input_tokens);
        const inputTokens =
            num(usage.input_tokens) + cachedInputTokens + cacheWriteTokens,
          outputTokens = num(usage.output_tokens);
        if (inputTokens + outputTokens === 0) continue;
        const tokens: TokenTotals = {
          inputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          outputTokens,
          reasoningTokens: Math.min(
            outputTokens,
            num(obj(usage.output_tokens_details).thinking_tokens),
          ),
          totalTokens: inputTokens + outputTokens,
        };
        const ttl = obj(usage.cache_creation);
        if (cacheWriteTokens > 0 && !Object.keys(ttl).length)
          parsed.missingTtl++;
        const write1hTokens = Math.min(
          cacheWriteTokens,
          num(ttl.ephemeral_1h_input_tokens),
        );
        // message.id is stable across content fragments and resumed/copied logs.
        const id =
          text(message.id) ||
          text(row.requestId) ||
          hash(`${session}:${timestamp}:${JSON.stringify(usage)}`);
        mergeEvent(parsed.events, {
          id,
          timestamp,
          session,
          model: rawModel,
          tokens,
          write1hTokens,
          speed: text(usage.speed),
          serviceTier: text(usage.service_tier),
          inferenceGeo: text(usage.inference_geo),
        });
      }
      if (row.type === "user" && !sidechain && row.isMeta !== true) {
        const content = message.content;
        const human =
          typeof content === "string"
            ? content.trim().length > 0
            : Array.isArray(content) &&
              content.some((block) =>
                ["text", "image", "document", "audio"].includes(
                  String(obj(block).type),
                ),
              );
        if (!human) continue;
        const id =
          text(row.uuid) ||
          text(row.promptId) ||
          hash(`${session}:${timestamp}:${JSON.stringify(content)}`);
        parsed.humans.set(id, { id, timestamp, session });
      }
    }
  } finally {
    input.destroy();
    source.destroy();
  }
  cache.set(file, { size: metadata.size, mtime: metadata.mtimeMs, parsed });
  return parsed;
}

// The ledger lives beside the other private snapshots. It is keyed by Claude
// home so different homes never mix, and it is off for an explicit home
// argument (tests, scripted callers) unless CLAUDE_LEDGER_PATH names one.
function ledgerPath(
  explicitHome: string | undefined,
  claudeHome: string,
): string | null {
  if (/^(0|false|no|off)$/i.test(process.env.CLAUDE_LEDGER || "")) return null;
  if (process.env.CLAUDE_LEDGER_PATH)
    return path.resolve(
      /* turbopackIgnore: true */ process.env.CLAUDE_LEDGER_PATH,
    );
  if (explicitHome !== undefined) return null;
  return path.join(
    process.cwd(),
    "data",
    `claude-ledger-${hash(claudeHome).slice(0, 8)}.jsonl`,
  );
}
export async function collectClaudeUsage(
  explicitHome?: string,
  explicitDesktopHome?: string | null,
): Promise<UsageSnapshot> {
  const configuredHome = explicitHome ?? process.env.CLAUDE_HOME;
  const claudeHome = path.resolve(
    /* turbopackIgnore: true */ configuredHome || path.join(homedir(), ".claude"),
  );
  // An explicit Claude home stays isolated (tests, custom setups) unless a
  // desktop home is also named; the default scan includes the desktop app.
  const desktopHome =
    explicitDesktopHome !== undefined
      ? explicitDesktopHome
      : process.env.CLAUDE_DESKTOP_HOME ||
        (configuredHome ? null : defaultDesktopHome());
  const timezone = process.env.USAGE_TIMEZONE || "Australia/Sydney";
  const dateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hourFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const dateOf = (t: string) => dateFormat.format(new Date(t));
  const roots = [
    path.join(claudeHome, "projects"),
    ...(desktopHome
      ? await desktopProjectDirs(
          path.resolve(/* turbopackIgnore: true */ desktopHome),
        )
      : []),
  ];
  // Overlapping copies are harmless: events are de-duplicated by message ID.
  const paths = [
    ...new Set((await Promise.all(roots.map(inventory))).flat()),
  ].sort();
  const present = new Set(paths);
  for (const file of cache.keys())
    if (
      !present.has(file) &&
      [claudeHome, ...(desktopHome ? [path.resolve(desktopHome)] : [])].some(
        (root) => file.startsWith(root + path.sep),
      )
    )
      cache.delete(file);
  const responses = new Map<string, Event>(),
    human = new Map<string, Human>();
  let malformedLines = 0,
    missingTtl = 0;
  for (const file of paths) {
    const parsed = await parseFile(file);
    for (const event of parsed.events.values()) mergeEvent(responses, event);
    for (const [id, request] of parsed.humans) human.set(id, request);
    malformedLines += parsed.malformed;
    missingTtl += parsed.missingTtl;
  }
  // Claude Code deletes old transcripts, so the ledger keeps what earlier runs
  // saw. Events are re-keyed by one-way hash first: IDs and session names are
  // only ever used for de-duplication and counting, never displayed.
  const digest = (v: string) => hash(v).slice(0, 32);
  const liveEvents = new Map<string, Event>(),
    liveHumans = new Map<string, Human>();
  for (const event of responses.values())
    mergeEvent(liveEvents, {
      ...event,
      id: digest(event.id),
      session: digest(event.session),
    });
  for (const request of human.values()) {
    const id = digest(request.id);
    liveHumans.set(id, { ...request, id, session: digest(request.session) });
  }
  const ledgerFile = ledgerPath(explicitHome, claudeHome);
  let retained = 0,
    ledgerError = false,
    eventMap = liveEvents,
    humanMap = liveHumans;
  if (ledgerFile)
    try {
      const saved = await loadLedger(ledgerFile);
      const mergedEvents = new Map(saved.events),
        mergedHumans = new Map(saved.humans);
      for (const event of liveEvents.values()) mergeEvent(mergedEvents, event);
      for (const [id, request] of liveHumans) mergedHumans.set(id, request);
      // Persist only what is new or has grown since it was last written.
      const newEvents = [...mergedEvents.values()].filter((event) => {
        const old = saved.events.get(event.id);
        return (
          !old ||
          event.tokens.inputTokens > old.tokens.inputTokens ||
          event.tokens.outputTokens > old.tokens.outputTokens ||
          event.tokens.cachedInputTokens > old.tokens.cachedInputTokens ||
          event.tokens.cacheWriteTokens > old.tokens.cacheWriteTokens ||
          event.tokens.reasoningTokens > old.tokens.reasoningTokens ||
          event.write1hTokens > old.write1hTokens
        );
      });
      const newHumans = [...mergedHumans.values()].filter(
        (request) => !saved.humans.has(request.id),
      );
      await appendLedger(ledgerFile, newEvents, newHumans);
      retained =
        [...mergedEvents.keys()].filter((id) => !liveEvents.has(id)).length +
        [...mergedHumans.keys()].filter((id) => !liveHumans.has(id)).length;
      eventMap = mergedEvents;
      humanMap = mergedHumans;
    } catch {
      // History must never become unreadable because the ledger is.
      ledgerError = true;
    }
  const events = [...eventMap.values()].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const models = new Map<string, ModelUsage>(),
    daily = new Map<string, DailyUsage>(),
    dayModels = new Map<string, Map<string, ModelUsage>>(),
    daySessions = new Map<string, Set<string>>(),
    sessions = new Set<string>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tokens: 0,
    requests: 0,
  }));
  const totals: UsageSnapshot["totals"] = {
    ...zero(),
    sessions: 0,
    humanRequests: humanMap.size,
    assistantRequests: events.length,
    averageTokensPerSession: 0,
    costUsd: 0,
    unpricedTokens: 0,
  };
  const getDay = (date: string): DailyUsage => {
    if (!daily.has(date))
      daily.set(date, {
        ...zero(),
        date,
        models: [],
        sessions: 0,
        humanRequests: 0,
        assistantRequests: 0,
        costUsd: 0,
        unpricedTokens: 0,
      });
    return daily.get(date)!;
  };
  const getModel = (
    target: Map<string, ModelUsage>,
    name: string,
  ): ModelUsage => {
    if (!target.has(name))
      target.set(name, {
        ...zero(),
        model: name,
        costUsd: 0,
        requests: 0,
        priced: estimateClaudeCost(name, zero()) !== null,
        unpricedTokens: 0,
      });
    return target.get(name)!;
  };
  const markSession = (date: string, session: string) => {
    sessions.add(session);
    if (!daySessions.has(date)) daySessions.set(date, new Set());
    daySessions.get(date)!.add(session);
  };
  const costs: number[] = [];
  for (const event of events) {
    const date = dateOf(event.timestamp),
      d = getDay(date),
      m = getModel(models, event.model);
    if (!dayModels.has(date)) dayModels.set(date, new Map());
    const dm = getModel(dayModels.get(date)!, event.model),
      cost = estimateClaudeCost(event.model, event.tokens, event);
    for (const target of [totals, d, m, dm]) {
      add(target, event.tokens);
      target.costUsd += cost || 0;
    }
    d.assistantRequests++;
    m.requests++;
    dm.requests++;
    if (cost === null)
      for (const target of [totals, d, m, dm])
        target.unpricedTokens += event.tokens.totalTokens;
    costs.push(cost || 0);
    markSession(date, event.session);
    const hour = hours[Number(hourFormat.format(new Date(event.timestamp)))];
    hour.tokens += event.tokens.totalTokens;
    hour.requests++;
  }
  for (const request of humanMap.values()) {
    const date = dateOf(request.timestamp);
    getDay(date).humanRequests++;
    markSession(date, request.session);
  }
  for (const [date, d] of daily) {
    d.models = [...(dayModels.get(date)?.values() || [])];
    d.sessions = daySessions.get(date)?.size || 0;
  }
  totals.sessions = sessions.size;
  totals.averageTokensPerSession = sessions.size
    ? totals.totalTokens / sessions.size
    : 0;
  const days = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const expensive = [...days]
    .filter((d) => d.assistantRequests > 0)
    .sort((a, b) => b.costUsd - a.costUsd)[0];
  let mostExpensive24h: UsageSnapshot["mostExpensive24h"] = null,
    left = 0,
    windowCost = 0,
    windowTokens = 0;
  for (let right = 0; right < events.length; right++) {
    const end = Date.parse(events[right].timestamp);
    windowCost += costs[right];
    windowTokens += events[right].tokens.totalTokens;
    while (end - Date.parse(events[left].timestamp) >= 86_400_000) {
      windowCost -= costs[left];
      windowTokens -= events[left].tokens.totalTokens;
      left++;
    }
    if (!mostExpensive24h || windowCost > mostExpensive24h.costUsd)
      mostExpensive24h = {
        start: new Date(end - 86_400_000).toISOString(),
        end: new Date(end).toISOString(),
        costUsd: windowCost,
        tokens: windowTokens,
      };
  }
  return {
    version: 1,
    provider: "claude",
    generatedAt: new Date().toISOString(),
    source: "local",
    timezone,
    coverage: {
      firstEvent: events[0]?.timestamp || null,
      lastEvent: events.at(-1)?.timestamp || null,
      filesScanned: paths.length,
      malformedLines,
      warnings: [
        ledgerFile && !ledgerError
          ? "Claude Code transcripts plus this dashboard's private history ledger, which keeps token counts (never prompts) after Claude Code deletes old transcripts. Usage from before the ledger began that was already deleted, other devices, and web-only activity are missing; this is not an account lifetime total."
          : "Available local Claude Code history only. Deleted history, other devices, and web-only activity may be missing; this is not an account lifetime total.",
        ...(retained
          ? [
              `${retained.toLocaleString("en-US")} recorded messages and prompts come from the ledger because Claude Code has since deleted their transcripts.`,
            ]
          : []),
        ...(ledgerError
          ? [
              "The private history ledger could not be read or written, so only transcripts still on disk are counted. Claude Code may delete old transcripts (cleanupPeriodDays defaults to 30 days).",
            ]
          : []),
        "Input includes ordinary input, cache reads, and cache writes. Thinking is included in output, not added twice. Repeated assistant content fragments are merged by message ID.",
        "API-equivalent USD uses current published prices, recorded cache TTL, speed and geography. It is not your subscription bill; separately billed tools are excluded. Unknown models are unpriced.",
        "Human requests exclude tool results, metadata and sidechains. Sessions include subagents with recorded usage. Most expensive 24h is a rolling window; daily charts use the selected timezone.",
        ...(missingTtl
          ? [
              "Some cache writes lack TTL detail and use the published 5-minute cache-write rate.",
            ]
          : []),
      ],
    },
    totals,
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    daily: days,
    hours,
    mostExpensiveDay: expensive
      ? {
          date: expensive.date,
          costUsd: expensive.costUsd,
          tokens: expensive.totalTokens,
        }
      : null,
    mostExpensive24h,
    pricing: {
      checkedAt: CLAUDE_PRICING_CHECKED_AT,
      sources: CLAUDE_PRICING_SOURCES,
    },
  };
}
