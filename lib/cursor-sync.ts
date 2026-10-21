import { createHash } from "node:crypto";
import type { TokenTotals } from "./types";

// Opt-in (CURSOR_AUTO_SYNC=true) read-only sync of the signed-in user's own
// usage events from Cursor's dashboard API, replacing manual CSV exports.
//
// Trust boundaries:
//  - The only credential read is the local Cursor app's access token, from one
//    exact key. It is held in memory for the request and never logged, stored,
//    returned, or placed in a snapshot.
//  - The only host contacted is the fixed ENDPOINT below; redirects are refused
//    so the cookie cannot be forwarded elsewhere.
//  - The endpoint is undocumented. Every field is validated and any failure
//    degrades to the local/CSV sources with a visible warning.
export type SyncedEvent = {
  id: string;
  timestamp: string;
  model: string;
  tokens: TokenTotals;
  session?: string;
  // Cost Cursor itself reports for the event (USD), when it reports one.
  reportedUsd?: number;
};
export type SyncResult = {
  events: SyncedEvent[];
  state: "off" | "ok" | "error";
  message?: string;
  malformed: number;
};

const ENDPOINT = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const TOKEN_KEY = "cursorAuth/accessToken";
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const REFRESH_MS = 10 * 60_000;
const RETRY_MS = 60_000;
// New events can be re-ordered or backfilled slightly, so re-read a day back.
const OVERLAP_MS = 86_400_000;

class SyncError extends Error {}

type Cache = {
  events: Map<string, SyncedEvent>;
  newest: number;
  syncedAt: number;
  malformed: number;
};
let cache: Cache | null = null;
let failure: { at: number; message: string } | null = null;
let inflight: Promise<SyncResult> | null = null;

export const cursorSyncEnabled = () =>
  /^(1|true|yes|on)$/i.test(process.env.CURSOR_AUTO_SYNC || "");
export function resetCursorSyncCache() {
  cache = null;
  failure = null;
  inflight = null;
}

async function readCookie(dbPath: string): Promise<string> {
  let jwt = "";
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = database
        .prepare("SELECT value FROM ItemTable WHERE key = ?")
        .get(TOKEN_KEY);
      jwt = String(row?.value ?? "").replace(/^"|"$/g, "");
    } finally {
      database.close();
    }
  } catch {
    throw new SyncError(
      "Cursor auto-sync could not read the local Cursor app database.",
    );
  }
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt))
    throw new SyncError(
      "Cursor auto-sync found no signed-in Cursor session. Open Cursor and sign in.",
    );
  let claims: { sub?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  } catch {
    throw new SyncError("Cursor auto-sync could not read the saved login.");
  }
  if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now())
    throw new SyncError(
      "Your saved Cursor login has expired. Open Cursor once to refresh it.",
    );
  const userId = String(claims.sub ?? "").split("|").pop() || "";
  // Validated before use so nothing unexpected can reach the Cookie header.
  if (!/^user_[A-Za-z0-9]{8,64}$/.test(userId))
    throw new SyncError("Cursor auto-sync could not read the saved login.");
  return `WorkosCursorSessionToken=${userId}%3A%3A${jwt}`;
}

async function fetchPage(
  cookie: string,
  page: number,
  startDate?: number,
): Promise<{ total: number; events: unknown[] }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      Origin: "https://cursor.com",
      Cookie: cookie,
    },
    body: JSON.stringify({
      page,
      pageSize: PAGE_SIZE,
      ...(startDate ? { startDate: String(startDate) } : {}),
    }),
  });
  if (response.status === 401 || response.status === 403)
    throw new SyncError(
      "Cursor rejected the saved login. Open Cursor once to refresh it.",
    );
  if (!response.ok)
    throw new SyncError(`Cursor usage sync failed (HTTP ${response.status}).`);
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES)
    throw new SyncError("Cursor usage sync returned an unexpectedly large page.");
  let body: { totalUsageEventsCount?: unknown; usageEventsDisplay?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    throw new SyncError("Cursor usage sync returned an unreadable response.");
  }
  if (!Array.isArray(body.usageEventsDisplay))
    throw new SyncError("Cursor usage sync returned an unexpected format.");
  return {
    total: Number(body.totalUsageEventsCount) || 0,
    events: body.usageEventsDisplay,
  };
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
// Absent token fields mean zero; present ones must be non-negative integers.
const count = (v: unknown): number | null =>
  v === undefined || v === null
    ? 0
    : typeof v === "number" && Number.isSafeInteger(v) && v >= 0
      ? v
      : null;
// The API calls Cursor's Auto router "default"; the CSV export calls it "auto".
// Model names must satisfy the same pattern snapshot validation enforces.
export function normalizeModel(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "default") return "auto";
  const safe = name.replace(/[^a-zA-Z0-9._:/-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.slice(0, 100) || "unknown";
}

function parseEvents(raw: unknown[]): { events: SyncedEvent[]; malformed: number } {
  const events: SyncedEvent[] = [];
  const seen = new Map<string, number>();
  let malformed = 0;
  for (const item of raw) {
    const e = record(item),
      usage = record(e.tokenUsage),
      ms = Number(e.timestamp),
      fresh = count(usage.inputTokens),
      read = count(usage.cacheReadTokens),
      write = count(usage.cacheWriteTokens),
      output = count(usage.outputTokens);
    if (
      !Number.isSafeInteger(ms) ||
      ms <= 0 ||
      fresh === null ||
      read === null ||
      write === null ||
      output === null
    ) {
      malformed++;
      continue;
    }
    const inputTokens = fresh + read + write,
      totalTokens = inputTokens + output;
    if (!Number.isSafeInteger(totalTokens)) {
      malformed++;
      continue;
    }
    const model = normalizeModel(e.model);
    // usageEventId is missing on many events and repeated on others, so events
    // are identified by content plus occurrence, as in the CSV importer.
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([ms, model, e.kind, fresh, read, write, output]),
      )
      .digest("hex")
      .slice(0, 32);
    const occurrence = seen.get(fingerprint) || 0;
    seen.set(fingerprint, occurrence + 1);
    const cents = usage.totalCents;
    const session =
      typeof e.conversationId === "string" && e.conversationId.length <= 200
        ? e.conversationId
        : undefined;
    events.push({
      id: `api:${fingerprint}:${occurrence}`,
      timestamp: new Date(ms).toISOString(),
      model,
      tokens: {
        inputTokens,
        cachedInputTokens: read,
        cacheWriteTokens: write,
        outputTokens: output,
        reasoningTokens: 0,
        totalTokens,
      },
      session,
      reportedUsd:
        typeof cents === "number" && Number.isFinite(cents) && cents > 0
          ? cents / 100
          : undefined,
    });
  }
  return { events, malformed };
}

async function refresh(dbPath: string): Promise<SyncResult> {
  const cookie = await readCookie(dbPath);
  const incremental = cache ? Math.max(0, cache.newest - OVERLAP_MS) : 0;
  const events = new Map(cache?.events);
  let malformed = cache?.malformed || 0,
    newest = cache?.newest || 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(cookie, page, incremental || undefined);
    const parsed = parseEvents(batch.events);
    malformed += parsed.malformed;
    for (const event of parsed.events) {
      events.set(event.id, event);
      newest = Math.max(newest, Date.parse(event.timestamp));
    }
    if (!batch.events.length || page * PAGE_SIZE >= batch.total) break;
  }
  cache = { events, newest, syncedAt: Date.now(), malformed };
  failure = null;
  return { events: [...events.values()], state: "ok", malformed };
}

export async function syncCursorEvents(dbPath: string): Promise<SyncResult> {
  if (!cursorSyncEnabled())
    return { events: [], state: "off", malformed: 0 };
  const fromCache = (state: SyncResult["state"], message?: string) => ({
    events: cache ? [...cache.events.values()] : [],
    state,
    message,
    malformed: cache?.malformed || 0,
  });
  if (cache && Date.now() - cache.syncedAt < REFRESH_MS)
    return fromCache("ok");
  // After a failure, wait before retrying so a 15s dashboard poll cannot
  // hammer Cursor with rejected requests.
  if (failure && Date.now() - failure.at < RETRY_MS)
    return fromCache("error", failure.message);
  inflight ??= refresh(dbPath)
    .catch((error): SyncResult => {
      const message =
        error instanceof SyncError
          ? error.message
          : "Cursor usage sync failed. Showing the last available data.";
      failure = { at: Date.now(), message };
      return fromCache("error", message);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
