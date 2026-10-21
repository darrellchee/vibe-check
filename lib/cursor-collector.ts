import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  estimateCursorCost,
  CURSOR_PRICING_CHECKED_AT,
  CURSOR_PRICING_SOURCES,
} from "./cursor-pricing";
import { syncCursorEvents } from "./cursor-sync";
import type {
  DailyUsage,
  ModelUsage,
  TokenTotals,
  UsageSnapshot,
} from "./types";

type Event = {
  id: string;
  timestamp: string;
  model: string;
  tokens: TokenTotals;
  session?: string;
  reportedUsd?: number;
};
type Human = { id: string; timestamp: string; session: string };
type Local = {
  humans: Human[];
  sessions: { session: string; timestamp: string }[];
  malformed: number;
  estimatedTimes: number;
};
type Csv = { events: Event[]; malformed: number; hasSessions: boolean };
const csvCache = new Map<string, { size: number; mtime: number; value: Csv }>();
const dbCache = new Map<string, { key: string; value: Local }>();
const zero = (): TokenTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});
const keys = Object.keys(zero()) as (keyof TokenTotals)[];
const add = (a: TokenTotals, b: TokenTotals) => {
  for (const k of keys) a[k] += b[k];
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown) => (typeof v === "string" ? v : undefined);
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const date = (v: unknown): string | null => {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (quoted && content[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted)
    throw new Error(
      "Cursor CSV has an unfinished quoted field. Export it again.",
    );
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
async function csvFiles(): Promise<string[]> {
  if (process.env.CURSOR_USAGE_CSV)
    return [
      path.resolve(/* turbopackIgnore: true */ process.env.CURSOR_USAGE_CSV),
    ];
  const dir = path.resolve(
    /* turbopackIgnore: true */ process.env.CURSOR_USAGE_DIR ||
      path.join(process.cwd(), "data/cursor-imports"),
  );
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".csv"))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function readCsv(file: string): Promise<Csv> {
  const metadata = await stat(file),
    cached = csvCache.get(file);
  if (
    cached &&
    cached.size === metadata.size &&
    cached.mtime === metadata.mtimeMs
  )
    return cached.value;
  if (metadata.size > 50 * 1024 * 1024)
    throw new Error(
      "Cursor CSV exceeds the 50 MB import limit. Split the export by date.",
    );
  const rows = parseCsv((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  const headers = (rows.shift() || []).map(normalized);
  const index = (...names: string[]) =>
    headers.findIndex((h) => names.map(normalized).includes(h));
  const columns = {
    date: index("Date", "Timestamp"),
    model: index("Model"),
    write: index(
      "Input (w/ Cache Write)",
      "Cache Write",
      "Cache Write Tokens",
      "Cache Creation Input Tokens",
    ),
    input: index(
      "Input (w/o Cache Write)",
      "Input Tokens",
      "Uncached Input Tokens",
    ),
    read: index("Cache Read", "Cache Read Tokens", "Cached Input Tokens"),
    output: index("Output Tokens", "Output"),
    total: index("Total Tokens"),
    id: index("Request ID", "Event ID", "Usage ID"),
    session: index("Conversation ID", "Session ID", "Composer ID"),
    kind: index("Kind", "Type"),
    max: index("Max Mode"),
  };
  if (
    [
      columns.date,
      columns.model,
      columns.write,
      columns.input,
      columns.read,
      columns.output,
    ].some((i) => i < 0)
  )
    throw new Error(
      "Cursor CSV is missing date, model, or the input/cache/output token columns. Use the Usage events export.",
    );
  const result: Csv = {
    events: [],
    malformed: 0,
    hasSessions: columns.session >= 0,
  };
  const number = (v: string | undefined): number | null => {
    const n = (v || "").trim().replace(/,/g, "");
    return /^\d+$/.test(n) && Number.isSafeInteger(Number(n))
      ? Number(n)
      : null;
  };
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const timestamp = date(row[columns.date]);
    const candidate = row[columns.model]?.trim();
    const model =
      candidate && /^[a-zA-Z0-9._:/-]{1,100}$/.test(candidate)
        ? candidate
        : "unknown";
    const fresh = number(row[columns.input]),
      cached = number(row[columns.read]),
      write = number(row[columns.write]),
      output = number(row[columns.output]);
    if (
      !timestamp ||
      fresh === null ||
      cached === null ||
      write === null ||
      output === null
    ) {
      result.malformed++;
      continue;
    }
    const inputTokens = fresh + cached + write,
      totalTokens = inputTokens + output;
    if (
      !Number.isSafeInteger(totalTokens) ||
      (columns.total >= 0 && number(row[columns.total]) !== totalTokens)
    ) {
      result.malformed++;
      continue;
    }
    const tokens: TokenTotals = {
      inputTokens,
      cachedInputTokens: cached,
      cacheWriteTokens: write,
      outputTokens: output,
      reasoningTokens: 0,
      totalTokens,
    };
    const fingerprint = hash(
      JSON.stringify([
        timestamp,
        model,
        tokens,
        row[columns.kind],
        row[columns.max],
      ]),
    );
    const occurrence = occurrences.get(fingerprint) || 0;
    occurrences.set(fingerprint, occurrence + 1);
    const id = row[columns.id]?.trim() || `${fingerprint}:${occurrence}`;
    result.events.push({
      id,
      timestamp,
      model,
      tokens,
      session: row[columns.session]?.trim() || undefined,
    });
  }
  csvCache.set(file, {
    size: metadata.size,
    mtime: metadata.mtimeMs,
    value: result,
  });
  return result;
}
function defaultDb(): string {
  if (process.platform === "darwin")
    return path.join(
      homedir(),
      "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
  if (process.platform === "win32")
    return path.join(
      process.env.APPDATA || path.join(homedir(), "AppData/Roaming"),
      "Cursor/User/globalStorage/state.vscdb",
    );
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    "Cursor/User/globalStorage/state.vscdb",
  );
}
async function readLocal(file: string): Promise<Local> {
  const empty: Local = {
    humans: [],
    sessions: [],
    malformed: 0,
    estimatedTimes: 0,
  };
  let metadata;
  try {
    metadata = await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw error;
  }
  const wal = await stat(file + "-wal").catch(() => null),
    key = `${metadata.size}:${metadata.mtimeMs}:${wal?.size}:${wal?.mtimeMs}`,
    cached = dbCache.get(file);
  if (cached?.key === key) return cached.value;
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(file, { readOnly: true });
  const result: Local = {
    humans: [],
    sessions: [],
    malformed: 0,
    estimatedTimes: 0,
  };
  try {
    if (
      !database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'",
        )
        .get()
    )
      return result;
    // SQL projects only allowlisted activity metadata. Never read ItemTable,
    // transcript text, credentials or arbitrary full composer values.
    const statement = database.prepare(
      "SELECT json_extract(value,'$.composerId') AS id,json_extract(value,'$.createdAt') AS created,json_extract(value,'$.fullConversationHeadersOnly') AS headers,json_extract(value,'$.subComposerIds') AS children,json_extract(value,'$.isDraft') AS draft FROM cursorDiskKV WHERE key GLOB 'composerData:*' AND value IS NOT NULL AND json_valid(value)",
    );
    const records: {
      id: string;
      created: string;
      headers: unknown[];
      children: string[];
    }[] = [];
    for (const row of statement.iterate()) {
      if (row.draft === 1) continue;
      const id = text(row.id),
        created = date(row.created);
      if (!id || !created) continue;
      let headers: unknown, children: unknown;
      try {
        headers = JSON.parse(text(row.headers) || "[]");
        children = JSON.parse(text(row.children) || "[]");
      } catch {
        result.malformed++;
        continue;
      }
      if (!Array.isArray(headers) || !headers.length) continue;
      records.push({
        id,
        created,
        headers,
        children: Array.isArray(children)
          ? children.filter((c): c is string => typeof c === "string")
          : [],
      });
    }
    const agents = new Set(records.flatMap((r) => r.children)),
      seen = new Set<string>();
    for (const record of records) {
      result.sessions.push({ session: record.id, timestamp: record.created });
      if (agents.has(record.id)) continue;
      for (const raw of record.headers) {
        const header = obj(raw),
          id = text(header.bubbleId);
        if (header.type !== 1 || !id || seen.has(id)) continue;
        seen.add(id);
        const ownDate = date(header.createdAt);
        if (!ownDate) result.estimatedTimes++;
        result.humans.push({
          id,
          timestamp: ownDate || record.created,
          session: record.id,
        });
      }
    }
  } finally {
    database.close();
  }
  dbCache.set(file, { key, value: result });
  return result;
}

export async function collectCursorUsage(): Promise<UsageSnapshot> {
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
  const dbPath = path.resolve(
    /* turbopackIgnore: true */ process.env.CURSOR_DB_PATH || defaultDb(),
  );
  const files = await csvFiles(),
    eventsById = new Map<string, Event>(),
    sync = await syncCursorEvents(dbPath);
  let malformedLines = sync.malformed;
  // Account events are authoritative for the range they cover. Imported CSV
  // rows are kept only for earlier dates, so the two never double count.
  const syncFirst = sync.events.reduce<string | null>(
    (first, e) => (first === null || e.timestamp < first ? e.timestamp : first),
    null,
  );
  for (const file of files) {
    const parsed = await readCsv(file);
    malformedLines += parsed.malformed;
    for (const event of parsed.events)
      if (syncFirst === null || event.timestamp < syncFirst)
        eventsById.set(event.id, event);
  }
  for (const event of sync.events) eventsById.set(event.id, event);
  const csvMode = files.length > 0,
    syncMode = sync.events.length > 0,
    tokenMode = csvMode || syncMode;
  const events = [...eventsById.values()].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  // Local conversation metadata supplies activity (sessions, human prompts,
  // calendar days) across the whole retained history. A CSV only covers the
  // date range that was exported, so it supplies tokens, models and cost.
  const emptyLocal = (): Local => ({
    humans: [],
    sessions: [],
    malformed: 0,
    estimatedTimes: 0,
  });
  let localError = false;
  const local = await readLocal(dbPath).catch((error) => {
    // A working token view must survive an unreadable or locked Cursor database.
    if (!tokenMode) throw error;
    localError = true;
    return emptyLocal();
  });
  malformedLines += local.malformed;
  const localSessions = local.sessions.length > 0,
    csvSessions =
      tokenMode && events.length > 0 && events.every((e) => !!e.session),
    sessionsAvailable = localSessions || csvSessions,
    humanAvailable = localSessions;
  const tokensAvailable =
    tokenMode && (events.length > 0 || malformedLines === 0);
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
    humanRequests: local.humans.length,
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
        priced: estimateCursorCost(name, zero()) !== null,
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
      // Published-price estimate first; where there is none (Auto, Composer and
      // other routed models) fall back to the cost Cursor reports for the event.
      cost =
        estimateCursorCost(event.model, event.tokens) ?? event.reportedUsd ?? null;
    if (cost !== null) m.priced = dm.priced = true;
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
    // CSV conversation IDs and local composer IDs are different namespaces, so
    // CSV sessions are only counted when there is no local session source.
    if (csvSessions && !localSessions && event.session)
      markSession(d, event.session);
    const h = hours[Number(hourFormat.format(new Date(event.timestamp)))];
    h.tokens += event.tokens.totalTokens;
    h.requests++;
    costs.push(cost || 0);
  }
  for (const s of local.sessions) {
    day(dateOf(s.timestamp));
    markSession(dateOf(s.timestamp), s.session);
  }
  for (const h of local.humans) {
    const d = dateOf(h.timestamp);
    day(d).humanRequests++;
    markSession(d, h.session);
  }
  for (const [d, bucket] of daily) {
    bucket.models = [...(dayModels.get(d)?.values() || [])];
    bucket.sessions = daySessions.get(d)?.size || 0;
  }
  totals.sessions = sessions.size;
  totals.averageTokensPerSession =
    sessionsAvailable && sessions.size ? totals.totalTokens / sessions.size : 0;
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
  const csvFirst = events[0]?.timestamp,
    csvLast = events.at(-1)?.timestamp;
  const timestamps = [
    ...events.map((e) => e.timestamp),
    ...local.sessions.map((e) => e.timestamp),
    ...local.humans.map((e) => e.timestamp),
  ].sort();
  const activityTimes = [...local.sessions, ...local.humans].map(
    (e) => e.timestamp,
  );
  // The failure this guards against: a stale or single-day export silently
  // standing in for the whole account while local activity runs far beyond it.
  const staleExport =
    !!csvFirst &&
    !!csvLast &&
    activityTimes.some(
      (t) => dateOf(t) < dateOf(csvFirst) || dateOf(t) > dateOf(csvLast),
    );
  return {
    provider: "cursor",
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "local",
    timezone,
    availability: {
      tokens: tokensAvailable,
      cost: tokensAvailable && [...models.values()].some((m) => m.priced),
      sessions: sessionsAvailable,
      humanRequests: humanAvailable,
      assistantRequests: tokensAvailable,
      cacheBreakdown: tokensAvailable,
    },
    coverage: {
      firstEvent: timestamps[0] || null,
      lastEvent: timestamps.at(-1) || null,
      filesScanned: files.length + (localSessions ? 1 : 0),
      malformedLines,
      warnings: tokenMode
        ? [
            syncMode
              ? "Source: your Cursor account's usage events, fetched read-only with the login saved by the Cursor app and refreshed about every 10 minutes, plus local conversation metadata for sessions and human requests. The login stays on this machine and is never stored or uploaded."
              : localSessions
                ? "Source: imported Cursor Usage events CSV for tokens, models and cost, plus local Cursor conversation metadata for sessions, human requests and the activity calendar. Token, model and cost figures cover only the exported date ranges, not your complete account lifetime."
                : "Source: imported Cursor Usage events CSV only. Coverage is limited to the exported date ranges, not your complete account lifetime. Update the CSV export to refresh these figures.",
            ...(sync.state === "error"
              ? [
                  `${sync.message} ${syncMode ? "Showing the last synced data." : "Falling back to local and imported data."}`,
                ]
              : []),
            ...(staleExport
              ? [
                  `Token data only covers ${dateOf(csvFirst!)} to ${dateOf(csvLast!)}, but local activity extends beyond that range. Tokens, models and cost are missing for those days. Set CURSOR_AUTO_SYNC=true to fetch them from your account, or export a fresh Usage events CSV.`,
                ]
              : []),
            "Input includes ordinary input, cache reads and cache writes. Exported token totals are reconciled per row. Recorded errored/not-charged events can still contain tokens; this is API-equivalent activity, not your Cursor bill.",
            localSessions
              ? "Sessions and human requests come from local conversation metadata (empty/draft conversations excluded; deleted sessions and other devices can be missing). Usage events do not distinguish human prompts from internal model calls."
              : "Sessions require a conversation ID in every imported event. Human requests are unavailable because usage events do not distinguish human prompts from internal model calls.",
            syncMode
              ? "API-equivalent USD uses published provider prices and a 5-minute cache-write assumption where TTL is absent. Where no published price exists (Auto, Composer and other routed models), the cost Cursor reports for each event is used instead. Separately billed tools and Cursor-specific billing multipliers are excluded."
              : "API-equivalent USD uses published provider prices and a 5-minute cache-write assumption where TTL is absent. Auto, Composer and unknown underlying models are unpriced; separately billed tools and Cursor-specific billing multipliers are excluded.",
            ...(csvMode
              ? [
                  "Overlapping exports are deduplicated by event ID when provided, otherwise by an occurrence-aware fingerprint. Identical repeated rows within an export remain separate requests.",
                ]
              : []),
            ...(localError
              ? [
                  "The local Cursor database could not be read, so activity shows token data only.",
                ]
              : []),
            ...(local.estimatedTimes
              ? [
                  "Some human prompt timestamps are unavailable; their activity day uses the conversation creation date.",
                ]
              : []),
          ]
        : [
            "Source: local Cursor conversation-header metadata only. Empty/draft conversations are excluded. Retained history can omit deleted sessions and other devices.",
            "Token usage, cache breakdown, model-call counts and API-equivalent cost are unavailable from this local source. Sparse tokenCount values have incomplete model/cache coverage and are not an authoritative lifetime ledger.",
            ...(sync.state === "error" ? [sync.message!] : []),
            "Set CURSOR_AUTO_SYNC=true to fetch token and model usage from your Cursor account automatically, or import a Cursor Usage events CSV with CURSOR_USAGE_CSV or CURSOR_USAGE_DIR (default data/cursor-imports). Without CURSOR_AUTO_SYNC no account credentials are read or copied.",
            ...(local.estimatedTimes
              ? [
                  "Some human prompt timestamps are unavailable; their activity day uses the conversation creation date.",
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
      checkedAt: CURSOR_PRICING_CHECKED_AT,
      sources: CURSOR_PRICING_SOURCES,
    },
  };
}
