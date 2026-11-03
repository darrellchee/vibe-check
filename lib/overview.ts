import { PROVIDERS } from "./providers";
import type { DailyUsage, MetricAvailability, UsageProvider, UsageSnapshot } from "./types";

export interface HarnessUsage {
  provider: UsageProvider;
  snapshot?: UsageSnapshot;
  error?: string;
}

export const metricAvailable = (snapshot: UsageSnapshot, metric: keyof MetricAvailability) =>
  snapshot.availability?.[metric] ?? true;

export function hasHistory(snapshot: UsageSnapshot) {
  return Boolean(snapshot.coverage.firstEvent || snapshot.daily.length ||
    snapshot.totals.totalTokens || snapshot.totals.sessions ||
    snapshot.totals.humanRequests || snapshot.totals.assistantRequests);
}

// Read the existing private endpoints; All is a view, never a stored provider.
export async function loadHarnesses(fetcher: typeof fetch = fetch) {
  let locked = false;
  const harnesses = await Promise.all(PROVIDERS.map(async (provider): Promise<HarnessUsage> => {
    try {
      const response = await fetcher(`/api/usage?provider=${provider}`, { cache: "no-store" });
      if (response.status === 401) {
        locked = true;
        return { provider, error: "Sign in to view usage." };
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load usage.");
      if ((body.provider || "codex") !== provider)
        throw new Error("Received usage for a different harness. Try refreshing.");
      return { provider, snapshot: body };
    } catch (error) {
      return { provider, error: error instanceof Error ? error.message : "Could not connect." };
    }
  }));
  // Never retain or display private data after an authorization failure.
  return { locked, harnesses: locked ? [] : harnesses };
}

const TOKEN_FIELDS = ["inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens", "totalTokens"] as const;
const AVAILABILITY_KEYS: (keyof MetricAvailability)[] = ["tokens", "cost", "sessions", "humanRequests", "assistantRequests", "cacheBreakdown"];

// One snapshot that adds up several harnesses, so the cards that draw a single snapshot can draw "All".
// A metric is summed only from harnesses that actually report it (as on the All dashboard) and counts as
// available when at least one does. Models and hours are left empty: no card shows them, and merging
// them across harnesses would imply a precision the sources do not share.
export function combineSnapshots(snapshots: UsageSnapshot[]): UsageSnapshot | null {
  const connected = snapshots.filter(hasHistory);
  if (!connected.length) return null;
  const availability = Object.fromEntries(AVAILABILITY_KEYS.map((key) =>
    [key, connected.some((s) => metricAvailable(s, key))])) as unknown as MetricAvailability;
  const zeroTokens = () => Object.fromEntries(TOKEN_FIELDS.map((key) => [key, 0])) as Record<(typeof TOKEN_FIELDS)[number], number>;
  const totals = {
    ...zeroTokens(), sessions: 0, humanRequests: 0, assistantRequests: 0,
    averageTokensPerSession: 0, costUsd: 0, unpricedTokens: 0,
  };
  const days = new Map<string, DailyUsage>();
  for (const s of connected) {
    const tokens = metricAvailable(s, "tokens"), sessions = metricAvailable(s, "sessions"), cost = metricAvailable(s, "cost");
    const requests = metricAvailable(s, "humanRequests"), assistant = metricAvailable(s, "assistantRequests");
    if (tokens) for (const key of TOKEN_FIELDS) totals[key] += s.totals[key];
    if (sessions) totals.sessions += s.totals.sessions;
    if (requests) totals.humanRequests += s.totals.humanRequests;
    if (assistant) totals.assistantRequests += s.totals.assistantRequests;
    if (cost) totals.costUsd += s.totals.costUsd;
    if (tokens) totals.unpricedTokens += s.totals.unpricedTokens;
    for (const day of s.daily) {
      const row = days.get(day.date) ?? { ...zeroTokens(), date: day.date, models: [], sessions: 0, humanRequests: 0,
        assistantRequests: 0, costUsd: 0, unpricedTokens: 0 };
      if (tokens) { for (const key of TOKEN_FIELDS) row[key] += day[key]; row.unpricedTokens += day.unpricedTokens; }
      if (sessions) row.sessions += day.sessions;
      if (requests) row.humanRequests += day.humanRequests;
      if (assistant) row.assistantRequests += day.assistantRequests;
      if (cost) row.costUsd += day.costUsd;
      days.set(day.date, row);
    }
  }
  totals.averageTokensPerSession = totals.sessions ? Math.round(totals.totalTokens / totals.sessions) : 0;
  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const events = connected.flatMap((s) => [s.coverage.firstEvent, s.coverage.lastEvent]).filter((d): d is string => Boolean(d)).sort();
  const latest = connected.reduce((a, s) => (Date.parse(s.generatedAt) > Date.parse(a.generatedAt) ? s : a));
  return {
    availability, version: 1, generatedAt: latest.generatedAt, source: latest.source, timezone: latest.timezone,
    coverage: {
      firstEvent: events[0] ?? null, lastEvent: events.at(-1) ?? null,
      filesScanned: connected.reduce((sum, s) => sum + s.coverage.filesScanned, 0),
      malformedLines: connected.reduce((sum, s) => sum + s.coverage.malformedLines, 0), warnings: [],
    },
    totals, models: [], daily, hours: [], mostExpensiveDay: null, mostExpensive24h: null,
    pricing: { checkedAt: latest.pricing.checkedAt, sources: [] },
  };
}

export function summarizeHarnesses(harnesses: HarnessUsage[]) {
  const connected = harnesses.flatMap(({ provider, snapshot }) =>
    snapshot && hasHistory(snapshot) ? [{ provider, snapshot }] : []);
  const total = (metric: keyof MetricAvailability, value: (s: UsageSnapshot) => number) =>
    connected.reduce((sum, { snapshot }) =>
      sum + (metricAvailable(snapshot, metric) ? value(snapshot) : 0), 0);
  const reporting = (metric: keyof MetricAvailability) =>
    connected.filter(({ snapshot }) => metricAvailable(snapshot, metric)).length;
  const days = new Map<string, Record<UsageProvider, number> & { date: string }>();
  for (const { provider, snapshot } of connected) {
    if (!metricAvailable(snapshot, "tokens")) continue;
    for (const day of snapshot.daily) {
      const row = days.get(day.date) ?? {
        date: day.date, codex: 0, claude: 0, cursor: 0, antigravity: 0,
      };
      row[provider] += day.totalTokens;
      days.set(day.date, row);
    }
  }
  const recorded = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const daily = [];
  // Fill gaps so the chart does not imply activity on missing days.
  if (recorded.length) {
    for (let time = Date.parse(`${recorded[0].date}T12:00:00Z`);
      time <= Date.parse(`${recorded.at(-1)!.date}T12:00:00Z`); time += 86_400_000) {
      const date = new Date(time).toISOString().slice(0, 10);
      daily.push(days.get(date) ?? { date, codex: 0, claude: 0, cursor: 0, antigravity: 0 });
    }
  }
  return {
    connected,
    tokens: total("tokens", (s) => s.totals.totalTokens),
    cost: total("cost", (s) => s.totals.costUsd),
    sessions: total("sessions", (s) => s.totals.sessions),
    requests: total("humanRequests", (s) => s.totals.humanRequests),
    unpricedTokens: total("tokens", (s) => s.totals.unpricedTokens),
    reporting,
    daily,
  };
}
