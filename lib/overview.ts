import { PROVIDERS, providerName } from "./providers";
import type { DailyUsage, MetricAvailability, ModelUsage, UsageProvider, UsageSnapshot } from "./types";

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
  let locked = false,
    stale = false;
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
      if (response.headers.get("X-Usage-Stale") === "1") stale = true;
      return { provider, snapshot: body };
    } catch (error) {
      return { provider, error: error instanceof Error ? error.message : "Could not connect." };
    }
  }));
  // Never retain or display private data after an authorization failure.
  return { locked, stale, harnesses: locked ? [] : harnesses };
}

const TOKEN_FIELDS = ["inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens", "totalTokens"] as const;
const AVAILABILITY_KEYS: (keyof MetricAvailability)[] = ["tokens", "cost", "sessions", "humanRequests", "assistantRequests", "cacheBreakdown"];

// One snapshot that adds up several harnesses, so the cards that draw a single snapshot can draw "All".
// A metric is summed only from harnesses that actually report it (as on the All dashboard) and counts as
// available when at least one does. Models are summed by name from harnesses that report tokens, for
// the model cards, and each harness's tokens are kept for the harness card. Hours are left empty: summing different clocks would shift the peaks.
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
  const models = new Map<string, ModelUsage>();
  for (const s of connected) {
    if (!metricAvailable(s, "tokens")) continue;
    const priced = metricAvailable(s, "cost");
    for (const m of s.models) {
      const row = models.get(m.model) ?? {
        model: m.model, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
        reasoningTokens: 0, totalTokens: 0, costUsd: 0, requests: 0, priced: true, unpricedTokens: 0,
      };
      for (const key of TOKEN_FIELDS) row[key] += m[key];
      row.requests += m.requests;
      row.unpricedTokens += m.unpricedTokens;
      if (priced) row.costUsd += m.costUsd;
      row.priced &&= priced && m.priced;
      models.set(m.model, row);
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
    harnesses: connected.flatMap((s) => (metricAvailable(s, "tokens") && s.totals.totalTokens > 0
      ? [{ provider: s.provider ?? "codex", totalTokens: s.totals.totalTokens }] : [])),
    totals, models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens), daily, hours: [],
    mostExpensiveDay: null, mostExpensive24h: null, pricing: { checkedAt: latest.pricing.checkedAt, sources: [] },
  };
}

// The harness with the highest-value rolling 24 hours. Windows cannot be joined across harnesses
// from aggregates, so the All page shows the biggest single one and names its harness.
export function biggestWindow(harnesses: HarnessUsage[]) {
  let best: { provider: UsageProvider; window: NonNullable<UsageSnapshot["mostExpensive24h"]> } | null = null;
  for (const { provider, snapshot } of harnesses) {
    const window = snapshot && metricAvailable(snapshot, "cost") ? snapshot.mostExpensive24h : null;
    if (window && (!best || window.costUsd > best.window.costUsd)) best = { provider, window };
  }
  return best;
}

// Everything the full dashboard draws, for every harness at once. Builds on combineSnapshots and adds
// the parts the cards leave out: hours come only from harnesses recorded
// in the same timezone (summing different clocks would shift the peaks), and warnings keep their
// harness name. With no history anywhere it returns an empty snapshot so the page can still draw.
export function mergeHarnesses(harnesses: HarnessUsage[]): UsageSnapshot {
  const snapshots = harnesses.flatMap(({ snapshot }) => (snapshot ? [snapshot] : []));
  const base = combineSnapshots(snapshots) ?? emptySnapshot(snapshots);
  const withTokens = harnesses.flatMap(({ provider, snapshot }) =>
    snapshot && hasHistory(snapshot) && metricAvailable(snapshot, "tokens") ? [{ provider, snapshot }] : []);
  // The clock that holds the most tokens; harnesses recorded on another clock stay out of the hours.
  const byZone = new Map<string, number>();
  for (const { snapshot } of withTokens)
    byZone.set(snapshot.timezone, (byZone.get(snapshot.timezone) ?? 0) + snapshot.totals.totalTokens);
  const timezone = [...byZone].sort((a, b) => b[1] - a[1])[0]?.[0] ?? base.timezone;
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, tokens: 0, requests: 0 }));
  for (const { snapshot } of withTokens) {
    if (snapshot.timezone !== timezone) continue;
    for (const h of snapshot.hours) {
      if (!hours[h.hour]) continue;
      hours[h.hour].tokens += h.tokens;
      hours[h.hour].requests += h.requests;
    }
  }
  const costliest = base.availability?.cost
    ? base.daily.filter((d) => d.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd)[0]
    : undefined;
  const sources = new Set(snapshots.flatMap((s) => s.pricing.sources));
  return {
    ...base,
    timezone,
    hours,
    mostExpensiveDay: costliest ? { date: costliest.date, costUsd: costliest.costUsd, tokens: costliest.totalTokens } : null,
    mostExpensive24h: biggestWindow(harnesses)?.window ?? null,
    coverage: {
      ...base.coverage,
      warnings: harnesses.flatMap(({ provider, snapshot }) =>
        (snapshot?.coverage.warnings ?? []).map((w) => `${providerName(provider)}: ${w}`)),
    },
    pricing: { ...base.pricing, sources: [...sources] },
  };
}

function emptySnapshot(snapshots: UsageSnapshot[]): UsageSnapshot {
  const latest = snapshots.reduce<UsageSnapshot | null>((a, s) =>
    !a || Date.parse(s.generatedAt) > Date.parse(a.generatedAt) ? s : a, null);
  const zero = Object.fromEntries(TOKEN_FIELDS.map((key) => [key, 0])) as Record<(typeof TOKEN_FIELDS)[number], number>;
  return {
    availability: Object.fromEntries(AVAILABILITY_KEYS.map((key) => [key, true])) as unknown as MetricAvailability,
    version: 1,
    generatedAt: latest?.generatedAt ?? new Date().toISOString(),
    source: latest?.source ?? "local",
    timezone: latest?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    coverage: { firstEvent: null, lastEvent: null, filesScanned: 0, malformedLines: 0, warnings: [] },
    totals: { ...zero, sessions: 0, humanRequests: 0, assistantRequests: 0, averageTokensPerSession: 0, costUsd: 0, unpricedTokens: 0 },
    models: [], daily: [], hours: [], mostExpensiveDay: null, mostExpensive24h: null,
    pricing: { checkedAt: latest?.pricing.checkedAt ?? "", sources: [] },
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
