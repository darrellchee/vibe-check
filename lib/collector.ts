import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createZstdDecompress } from "node:zlib";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { estimateCost, PRICING_CHECKED_AT, PRICING_SOURCES } from "./pricing";
import type {
  DailyUsage,
  ModelUsage,
  TokenTotals,
  UsageSnapshot,
} from "./types";

type Obj = Record<string, unknown>;
interface Payload {
  type?: string;
  id?: string;
  session_id?: string;
  parent_thread_id?: string;
  thread_id?: string;
  response_id?: string;
  turn_id?: string;
  model?: string;
  service_tier?: string;
  speed?: string;
  role?: string;
  source?: string | { subagent?: unknown };
  agent_path?: string;
  subagent_history_start_ordinal?: number;
  content?: unknown;
  message?: unknown;
  internal_chat_message_metadata_passthrough?: { content_item_kinds?: unknown };
  usage?: Obj;
  info?: { total_token_usage?: Obj };
}
interface Row {
  type?: string;
  timestamp?: string;
  ordinal?: number;
  payload?: Payload;
}
type Event = {
  id: string;
  timestamp: string;
  session: string;
  model: string;
  tier?: string;
  tokens: TokenTotals;
};
const zero = (): TokenTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});
const keys = Object.keys(zero()) as (keyof TokenTotals)[];
const add = (target: TokenTotals, value: TokenTotals) => {
  for (const key of keys) target[key] += value[key];
};
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const modelName = (value: unknown, fallback = "unknown") =>
  typeof value === "string" && /^[a-zA-Z0-9._:/-]{1,100}$/.test(value)
    ? value
    : fallback;
function tokenValues(v: Obj): TokenTotals {
  const inputTokens = num(v.input_tokens),
    outputTokens = num(v.output_tokens);
  const cachedInputTokens = Math.min(inputTokens, num(v.cached_input_tokens));
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens: Math.min(
      inputTokens - cachedInputTokens,
      num(v.cache_write_input_tokens),
    ),
    reasoningTokens: Math.min(outputTokens, num(v.reasoning_output_tokens)),
    totalTokens: inputTokens + outputTokens,
  };
}
async function filesIn(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const batches = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? filesIn(path.join(dir, e.name))
        : e.isFile() &&
            (e.name.endsWith(".jsonl") || e.name.endsWith(".jsonl.zst"))
          ? [path.join(dir, e.name)]
          : [],
    ),
  );
  return batches.flat().sort();
}

interface ParsedFile {
  modern: Map<string, Event>;
  legacy: Event[];
  human: Map<string, { timestamp: string; session: string }>;
  authoritativeSessions: Set<string>;
  malformedLines: number;
}
// Only normalized counters and opaque deduplication keys are cached. Never retain transcript rows.
const parsedFiles = new Map<
  string,
  { size: number; mtimeMs: number; parsed: ParsedFile }
>();
async function parseFile(file: string): Promise<ParsedFile> {
  const metadata = await stat(file);
  const cached = parsedFiles.get(file);
  if (
    cached &&
    cached.size === metadata.size &&
    cached.mtimeMs === metadata.mtimeMs
  )
    return cached.parsed;
  const modern = new Map<string, Event>();
  const legacy: Event[] = [];
  const human = new Map<string, { timestamp: string; session: string }>();
  const authoritativeSessions = new Set<string>();
  let malformedLines = 0;
  let session = path.basename(file),
    model = "unknown",
    tier: string | undefined,
    isChild = false,
    childStart = -1;
  let sessionMetaSeen = false;
  let previous = zero();
  let previousLegacy = "";
  const source = createReadStream(file);
  const input = file.endsWith(".zst")
    ? source.pipe(createZstdDecompress())
    : source;
  source.on("error", (error) => input.destroy(error));
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let row: Row;
      try {
        row = JSON.parse(line);
      } catch {
        malformedLines++;
        continue;
      }
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        malformedLines++;
        continue;
      }
      if (
        row.payload !== undefined &&
        (!row.payload ||
          typeof row.payload !== "object" ||
          Array.isArray(row.payload))
      ) {
        malformedLines++;
        continue;
      }
      const p = row.payload || {};
      // A fork can embed the parent's session_meta after its own physical-file
      // header. The first header owns this file; inherited headers cannot change
      // the child's identity or disable its inherited-history cutoff.
      if (row.type === "session_meta" && !sessionMetaSeen) {
        sessionMetaSeen = true;
        session = p.id || p.session_id || session;
        isChild = !!(
          p.parent_thread_id ||
          (typeof p.source === "object" && p.source?.subagent) ||
          (p.agent_path && p.agent_path !== "/root")
        );
        childStart =
          typeof p.subagent_history_start_ordinal === "number"
            ? p.subagent_history_start_ordinal
            : -1;
      }
      if (row.type === "turn_context") {
        model = modelName(p.model, model);
        tier = p.service_tier || p.speed || undefined;
      }
      // Forked rollouts can contain inherited parent history. Keep context but exclude inherited usage/messages.
      if (
        isChild &&
        typeof row.ordinal === "number" &&
        row.ordinal < childStart &&
        row.type !== "session_meta"
      ) {
        // If a legacy child continues a parent's cumulative counter, retain its
        // baseline without counting inherited work as new child usage.
        if (
          row.type === "event_msg" &&
          p.type === "token_count" &&
          p.info?.total_token_usage
        ) {
          previous = tokenValues(p.info.total_token_usage);
          previousLegacy = JSON.stringify(previous);
        }
        continue;
      }
      if (
        typeof row.timestamp !== "string" ||
        !Number.isFinite(Date.parse(row.timestamp))
      )
        continue;
      const timestamp = new Date(row.timestamp).toISOString();
      if (
        !isChild &&
        ((row.type === "response_item" &&
          p.type === "message" &&
          p.role === "user") ||
          (row.type === "event_msg" && p.type === "user_message"))
      ) {
        const kinds =
          p.internal_chat_message_metadata_passthrough?.content_item_kinds;
        if (
          Array.isArray(kinds) &&
          !kinds.some(
            (kind: unknown) =>
              typeof kind === "string" && kind.startsWith("user."),
          )
        )
          continue;
        // Message contents are hashed locally only; they never leave this function.
        const id =
          p.id ||
          hash(
            `${session}:${timestamp}:${JSON.stringify(p.content || p.message || "")}`,
          );
        human.set(`${session}:${id}`, { timestamp, session });
      }
      if (row.type === "token_usage_record" && p.usage) {
        const id =
          p.response_id ||
          hash(
            `${session}:${p.turn_id || ""}:${timestamp}:${JSON.stringify(p.usage)}`,
          );
        const eventSession = p.thread_id || session;
        modern.set(id, {
          id,
          timestamp,
          session: eventSession,
          model: modelName(p.model, model),
          tier: p.service_tier || tier,
          tokens: tokenValues(p.usage),
        });
        authoritativeSessions.add(eventSession);
      }
      if (
        row.type === "event_msg" &&
        p.type === "token_count" &&
        p.info?.total_token_usage
      ) {
        const current = tokenValues(p.info.total_token_usage);
        const fingerprint = JSON.stringify(current);
        if (fingerprint === previousLegacy) continue;
        previousLegacy = fingerprint;
        const delta = zero();
        // Cumulative counters reset on a new underlying session; a reset begins a fresh segment.
        const reset = current.totalTokens < previous.totalTokens;
        for (const key of keys)
          delta[key] = reset
            ? current[key]
            : Math.max(0, current[key] - previous[key]);
        previous = current;
        if (delta.totalTokens > 0)
          legacy.push({
            id: hash(`${session}:${timestamp}:${fingerprint}`),
            timestamp,
            session,
            model,
            tier,
            tokens: delta,
          });
      }
    }
  } finally {
    lines.close();
    input.destroy();
    source.destroy();
  }
  const parsed = {
    modern,
    legacy,
    human,
    authoritativeSessions,
    malformedLines,
  };
  parsedFiles.set(file, {
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    parsed,
  });
  return parsed;
}

export async function collectUsage(
  codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex"),
): Promise<UsageSnapshot> {
  codexHome = path.resolve(/* turbopackIgnore: true */ codexHome);
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
  const paths = [
    ...(await filesIn(path.join(codexHome, "sessions"))),
    ...(await filesIn(path.join(codexHome, "archived_sessions"))),
  ];
  const modern = new Map<string, Event>();
  const legacy: Event[] = [];
  const human = new Map<string, { timestamp: string; session: string }>();
  const authoritativeSessions = new Set<string>();
  let malformedLines = 0;
  const present = new Set(paths);
  const homePrefix = codexHome + path.sep;
  for (const cachedPath of parsedFiles.keys()) {
    if (cachedPath.startsWith(homePrefix) && !present.has(cachedPath))
      parsedFiles.delete(cachedPath);
  }
  for (const file of paths) {
    const parsed = await parseFile(file);
    for (const [id, event] of parsed.modern) modern.set(id, event);
    legacy.push(...parsed.legacy);
    for (const [id, request] of parsed.human) human.set(id, request);
    for (const session of parsed.authoritativeSessions)
      authoritativeSessions.add(session);
    malformedLines += parsed.malformedLines;
  }
  const uniqueLegacy = [...new Map(legacy.map((e) => [e.id, e])).values()];
  const modernTotals = new Map<string, number>(),
    legacyTotals = new Map<string, number>();
  for (const e of modern.values())
    modernTotals.set(
      e.session,
      (modernTotals.get(e.session) || 0) + e.tokens.totalTokens,
    );
  for (const e of uniqueLegacy)
    legacyTotals.set(
      e.session,
      (legacyTotals.get(e.session) || 0) + e.tokens.totalTokens,
    );
  const mixedHistoryGaps = [...modernTotals].filter(
    ([session, total]) => (legacyTotals.get(session) || 0) > total,
  ).length;
  const events = [
    ...modern.values(),
    ...uniqueLegacy.filter((e) => !authoritativeSessions.has(e.session)),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const models = new Map<string, ModelUsage>();
  const daily = new Map<string, DailyUsage>();
  const sessions = new Set<string>();
  const daySessions = new Map<string, Set<string>>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tokens: 0,
    requests: 0,
  }));
  const totals: UsageSnapshot["totals"] = {
    ...zero(),
    sessions: 0,
    humanRequests: human.size,
    assistantRequests: events.length,
    averageTokensPerSession: 0,
    costUsd: 0,
    unpricedTokens: 0,
  };
  const day = (date: string): DailyUsage => {
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
  const modelAggregate = (
    target: Map<string, ModelUsage>,
    name: string,
  ): ModelUsage => {
    if (!target.has(name))
      target.set(name, {
        ...zero(),
        model: name,
        costUsd: 0,
        requests: 0,
        unpricedTokens: 0,
        priced: estimateCost(name, zero()) !== null,
      });
    return target.get(name)!;
  };
  const dailyModels = new Map<string, Map<string, ModelUsage>>();
  for (const e of events) {
    const date = dateOf(e.timestamp),
      d = day(date),
      m = modelAggregate(models, e.model);
    if (!dailyModels.has(date)) dailyModels.set(date, new Map());
    const dm = modelAggregate(dailyModels.get(date)!, e.model);
    const cost = estimateCost(e.model, e.tokens, e.tier);
    add(totals, e.tokens);
    add(d, e.tokens);
    add(m, e.tokens);
    add(dm, e.tokens);
    m.requests++;
    dm.requests++;
    d.assistantRequests++;
    totals.costUsd += cost || 0;
    d.costUsd += cost || 0;
    m.costUsd += cost || 0;
    dm.costUsd += cost || 0;
    if (cost === null) {
      totals.unpricedTokens += e.tokens.totalTokens;
      d.unpricedTokens += e.tokens.totalTokens;
      m.unpricedTokens += e.tokens.totalTokens;
      dm.unpricedTokens += e.tokens.totalTokens;
    }
    sessions.add(e.session);
    if (!daySessions.has(date)) daySessions.set(date, new Set());
    daySessions.get(date)!.add(e.session);
    const h = hours[Number(hourFormat.format(new Date(e.timestamp)))];
    h.tokens += e.tokens.totalTokens;
    h.requests++;
  }
  for (const h of human.values()) {
    const date = dateOf(h.timestamp);
    day(date).humanRequests++;
    sessions.add(h.session);
    if (!daySessions.has(date)) daySessions.set(date, new Set());
    daySessions.get(date)!.add(h.session);
  }
  for (const [date, d] of daily) {
    d.models = [...(dailyModels.get(date)?.values() || [])];
    d.sessions = daySessions.get(date)?.size || 0;
  }
  totals.sessions = sessions.size;
  totals.averageTokensPerSession = sessions.size
    ? totals.totalTokens / sessions.size
    : 0;
  const days = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const expensive = days
    .filter((d) => d.assistantRequests > 0)
    .sort((a, b) => b.costUsd - a.costUsd)[0];
  let mostExpensive24h: UsageSnapshot["mostExpensive24h"] = null;
  let left = 0,
    windowCost = 0,
    windowTokens = 0;
  const costs = events.map((e) => estimateCost(e.model, e.tokens, e.tier) || 0);
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
    generatedAt: new Date().toISOString(),
    source: "local",
    timezone,
    coverage: {
      firstEvent: events[0]?.timestamp || null,
      lastEvent: events.at(-1)?.timestamp || null,
      filesScanned: paths.length,
      malformedLines,
      warnings: [
        "Available local history only. Deleted history, other devices, and cloud-only sessions may be missing; this is not an account lifetime total.",
        "API-equivalent USD estimate uses current Standard prices, cache discounts, known speed settings and long-context rates. It is not your Pro bill. Unknown models are unpriced; tool charges are excluded.",
        "Human requests count locally recorded user messages in root chats, excluding context-only metadata when available. Older records may include automated prompts. Sessions include subagents with recorded usage.",
        "Most expensive day is a calendar day in the selected timezone, not a rolling 24-hour window.",
        ...(mixedHistoryGaps
          ? [
              `${mixedHistoryGaps} session(s) have cumulative counters larger than their per-response records. Earlier usage may be missing from totals; per-response records take precedence to avoid double counting.`,
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
    pricing: { checkedAt: PRICING_CHECKED_AT, sources: PRICING_SOURCES },
  };
}
