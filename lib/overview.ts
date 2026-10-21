import { PROVIDERS } from "./providers";
import type { MetricAvailability, UsageProvider, UsageSnapshot } from "./types";

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
