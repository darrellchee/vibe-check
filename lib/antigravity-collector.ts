import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  antigravityModelName,
  estimateAntigravityCost,
  ANTIGRAVITY_PRICING_CHECKED_AT,
  ANTIGRAVITY_PRICING_SOURCES,
} from "./antigravity-pricing";
import {
  fields,
  first,
  message,
  num,
  repeated,
  seconds,
  string,
} from "./protobuf";
import type {
  DailyUsage,
  ModelUsage,
  TokenTotals,
  UsageSnapshot,
} from "./types";

// Field map reverse-engineered from the local store; see ANTIGRAVITY-RESEARCH.md.
const STEP_USER_INPUT = 14;
const STEP_MODEL_RESPONSE = 15;

type Event = { timestamp: string; model: string; tokens: TokenTotals };
type Parsed = {
  events: Event[];
  humans: string[];
  failed: number;
  schemaWarnings: number;
  // User-input steps in conversations that reference a parent conversation.
  childHumans: number;
  firstTimestamp: string | null;
};
// Real prompts are a few hundred thousand tokens; anything near 2^40 is corruption.
const MAX_TOKENS = 2 ** 40;
const cache = new Map<string, { key: string; value: Parsed }>();

const zero = (): TokenTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});
// Iterate a fixed key list: targets also carry model/cost/request fields.
const keys = Object.keys(zero()) as (keyof TokenTotals)[];
const add = (a: TokenTotals, b: TokenTotals) => {
  for (const k of keys) a[k] += b[k];
};
const iso = (s: number | null) => (s ? new Date(s * 1000).toISOString() : null);

/** Conversation databases under one or more Antigravity data roots. */
async function inventory(): Promise<{ files: string[]; badRoots: number }> {
  const home = path.resolve(
    /* turbopackIgnore: true */ process.env.ANTIGRAVITY_HOME ||
      path.join(homedir(), ".gemini"),
  );
  const roots = ["antigravity", "antigravity-cli"].map((r) =>
    path.join(home, r, "conversations"),
  );
  const files: string[] = [];
  let badRoots = 0;
  for (const root of roots) {
    try {
      for (const entry of await readdir(/* turbopackIgnore: true */ root))
        if (entry.endsWith(".db")) files.push(path.join(root, entry));
    } catch (error) {
      // A missing root is normal; an unreadable one is reported, not fatal.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") badRoots++;
    }
  }
  return { files: files.sort(), badRoots };
}

function usageOf(
  list: ReturnType<typeof fields>,
): TokenTotals | null | "invalid" {
  const usage = message(list, 4);
  if (!usage) return null;
  const input = num(usage, 2),
    cacheRead = num(usage, 5),
    output = num(usage, 3);
  if (!input && !cacheRead && !output) return null;
  if ([input, cacheRead, output, num(usage, 9)].some((n) => n > MAX_TOKENS))
    return "invalid";
  const tokens = zero();
  // Total prompt is uncached input plus cache read; output includes thinking.
  tokens.inputTokens = input + cacheRead;
  tokens.cachedInputTokens = cacheRead;
  tokens.outputTokens = output;
  tokens.reasoningTokens = num(usage, 9);
  tokens.totalTokens = tokens.inputTokens + output;
  return tokens;
}

async function parse(file: string): Promise<Parsed> {
  const meta = await stat(file),
    wal = await stat(file + "-wal").catch(() => null),
    key = `${meta.size}:${meta.mtimeMs}:${wal?.size}:${wal?.mtimeMs}`,
    hit = cache.get(file);
  if (hit?.key === key) return hit.value;
  const { DatabaseSync } = await import("node:sqlite");
  // With no uncheckpointed WAL data, an immutable open reads the file without
  // creating -wal/-shm sidecars next to Antigravity's databases. Otherwise open
  // normally so recent writes are still visible.
  const immutable = !wal || wal.size === 0;
  const db = new DatabaseSync(
    immutable ? `${pathToFileURL(file).href}?mode=ro&immutable=1` : file,
    { readOnly: true, timeout: 2000 },
  );
  const result: Parsed = {
    events: [],
    humans: [],
    failed: 0,
    schemaWarnings: 0,
    childHumans: 0,
    firstTimestamp: null,
  };
  try {
    // Only the type and timing metadata of each step is read. step_payload,
    // render_info and other columns hold prompts and responses; never select them.
    const steps = new Map<number, { type: number; at: number | null }>();
    for (const row of db
      .prepare("SELECT idx, step_type, metadata FROM steps")
      .iterate()) {
      const meta = row.metadata
        ? fields(row.metadata as Uint8Array)
        : null;
      const at = seconds(message(meta, 1));
      steps.set(Number(row.idx), { type: Number(row.step_type), at });
      if (Number(row.step_type) === STEP_USER_INPUT && at)
        result.humans.push(iso(at)!);
    }
    // Conversations spawned by another conversation may hold delegated prompts.
    try {
      const n = db.prepare("SELECT count(*) AS n FROM parent_references").get();
      if (Number(n?.n) > 0) result.childHumans = result.humans.length;
    } catch {
      // Older databases have no parent_references table.
    }
    for (const row of db
      .prepare("SELECT idx, data FROM gen_metadata ORDER BY idx")
      .iterate()) {
      const top = fields(row.data as Uint8Array);
      if (!top) {
        result.schemaWarnings++;
        continue;
      }
      const body = message(top, 1),
        tokens = usageOf(body);
      if (tokens === "invalid") {
        result.schemaWarnings++;
        continue;
      }
      if (!tokens) {
        if (first(top, 5)) result.failed++;
        continue;
      }
      // Invariant from the research: output = thinking + visible response.
      const usage = message(body, 4);
      if (num(usage, 3) !== num(usage, 9) + num(usage, 10))
        result.schemaWarnings++;
      const indices = repeated(top, 2);
      const step =
        indices
          .map((i) => steps.get(i))
          .find((s) => s?.type === STEP_MODEL_RESPONSE && s.at) ||
        indices.map((i) => steps.get(i)).find((s) => s?.at);
      // Generation time (1.9.4) is a fallback only; it vanishes after 2026-08.
      const timestamp = iso(step?.at ?? seconds(message(message(body, 9), 4)));
      if (!timestamp) {
        result.schemaWarnings++;
        continue;
      }
      result.events.push({
        timestamp,
        model: antigravityModelName(string(body, 19), num(body, 3)),
        tokens,
      });
    }
  } finally {
    db.close();
  }
  const all = [...result.events.map((e) => e.timestamp), ...result.humans].sort();
  result.firstTimestamp = all[0] || null;
  cache.set(file, { key, value: result });
  return result;
}

export async function collectAntigravityUsage(): Promise<UsageSnapshot> {
  const timezone = process.env.USAGE_TIMEZONE || "Australia/Sydney";
  const format = new Intl.DateTimeFormat("en-CA", {
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
  const dateOf = (timestamp: string) => format.format(new Date(timestamp));
  const { files, badRoots } = await inventory();
  const events: (Event & { session: string })[] = [],
    humans: { timestamp: string; session: string }[] = [];
  let failed = 0,
    schemaWarnings = 0,
    childHumans = 0,
    unreadable = 0,
    stale = 0;
  for (const [index, file] of files.entries()) {
    let parsed: Parsed;
    try {
      parsed = await parse(file);
    } catch {
      // A locked or half-written database keeps its last good reading, so a
      // transient failure cannot shrink the snapshot that cloud sync uploads.
      const previous = cache.get(file)?.value;
      if (!previous) {
        unreadable++;
        continue;
      }
      parsed = previous;
      stale++;
    }
    childHumans += parsed.childHumans;
    const session = `conversation-${index}`;
    failed += parsed.failed;
    schemaWarnings += parsed.schemaWarnings;
    for (const e of parsed.events) events.push({ ...e, session });
    for (const timestamp of parsed.humans) humans.push({ timestamp, session });
  }
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
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
    humanRequests: humans.length,
    assistantRequests: events.length,
    averageTokensPerSession: 0,
    costUsd: 0,
    unpricedTokens: 0,
  };
  const day = (d: string): DailyUsage => {
    if (!daily.has(d))
      daily.set(d, {
        ...zero(),
        date: d,
        models: [],
        sessions: 0,
        humanRequests: 0,
        assistantRequests: 0,
        costUsd: 0,
        unpricedTokens: 0,
      });
    return daily.get(d)!;
  };
  const model = (target: Map<string, ModelUsage>, name: string): ModelUsage => {
    if (!target.has(name))
      target.set(name, {
        ...zero(),
        model: name,
        costUsd: 0,
        requests: 0,
        priced: estimateAntigravityCost(name, zero()) !== null,
        unpricedTokens: 0,
      });
    return target.get(name)!;
  };
  const markSession = (d: string, id: string) => {
    sessions.add(id);
    if (!daySessions.has(d)) daySessions.set(d, new Set());
    daySessions.get(d)!.add(id);
  };
  const costs: number[] = [];
  for (const event of events) {
    const d = dateOf(event.timestamp),
      bucket = day(d),
      m = model(models, event.model);
    if (!dayModels.has(d)) dayModels.set(d, new Map());
    const dm = model(dayModels.get(d)!, event.model),
      cost = estimateAntigravityCost(event.model, event.tokens);
    for (const target of [totals, bucket, m, dm]) {
      add(target, event.tokens);
      target.costUsd += cost || 0;
    }
    bucket.assistantRequests++;
    m.requests++;
    dm.requests++;
    if (cost === null)
      for (const target of [totals, bucket, m, dm])
        target.unpricedTokens += event.tokens.totalTokens;
    markSession(d, event.session);
    const h = hours[Number(hourFormat.format(new Date(event.timestamp)))];
    h.tokens += event.tokens.totalTokens;
    h.requests++;
    costs.push(cost || 0);
  }
  for (const h of humans) {
    const d = dateOf(h.timestamp);
    day(d).humanRequests++;
    markSession(d, h.session);
  }
  for (const [d, bucket] of daily) {
    bucket.models = [...(dayModels.get(d)?.values() || [])];
    bucket.sessions = daySessions.get(d)?.size || 0;
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
  const timestamps = [
    ...events.map((e) => e.timestamp),
    ...humans.map((h) => h.timestamp),
  ].sort();
  const available = files.length > unreadable && files.length > 0;
  const warnings = [
    "Source: Antigravity's local conversation databases (IDE and CLI), read-only. Each model call is one recorded generation. Deleted conversations, other devices and Antigravity cloud-side accounting are not covered.",
    "Antigravity is a plan and quota product. API-equivalent USD is a replacement-cost estimate at current published prices, not a bill, credit balance or quota percentage.",
    "Input includes cache reads. Output includes thinking tokens, which are billed once at the output rate. Cache-write tokens are not recorded, so Claude figures are a lower bound.",
    "Gemini Flash and Claude Opus 4.6 are priced; any model without a known price stays unpriced and is counted in unpriced tokens. Google lists the Gemini 3.6 and 3.8 Flash prices through 2026-12-31 and doubles them from 2027-01-01; dollar figures use current rates, so history re-prices when published rates change.",
    "Background context-compaction calls are not part of the recorded generations and are excluded (about 0.5% of tokens). Legacy encrypted conversations cannot be read. Token fields come from private, unversioned data and can change in an app update.",
    ...(failed
      ? [`${failed} model attempts failed with a quota error and used no tokens; they are not counted as requests.`]
      : []),
    ...(schemaWarnings
      ? [`${schemaWarnings} records did not match the expected layout and were skipped or flagged.`]
      : []),
    ...(unreadable
      ? [`${unreadable} conversation databases could not be read.`]
      : []),
    ...(stale
      ? [`${stale} conversation databases were busy; their previous readings were reused.`]
      : []),
    ...(badRoots
      ? [`${badRoots} Antigravity data folders could not be listed (check permissions).`]
      : []),
    ...(childHumans
      ? [`${childHumans} user-input steps are in conversations that reference a parent conversation and may be delegated prompts; they are included in human requests.`]
      : []),
  ];
  return {
    provider: "antigravity",
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "local",
    timezone,
    availability: {
      tokens: available,
      cost: available && [...models.values()].some((m) => m.priced),
      sessions: available,
      humanRequests: available,
      assistantRequests: available,
      cacheBreakdown: available,
    },
    coverage: {
      firstEvent: timestamps[0] || null,
      lastEvent: timestamps.at(-1) || null,
      filesScanned: files.length - unreadable,
      malformedLines: schemaWarnings,
      warnings,
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
      checkedAt: ANTIGRAVITY_PRICING_CHECKED_AT,
      sources: ANTIGRAVITY_PRICING_SOURCES,
    },
  };
}
