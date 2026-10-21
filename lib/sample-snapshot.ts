import type { DailyUsage, UsageProvider, UsageSnapshot } from "./types";

// Deterministic demo usage, used only to draw previews of cards when a provider has no recorded
// history yet. It is never stored, uploaded or served by the public endpoint.
function seeded(seed: string) {
  let state = 2166136261;
  for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleSnapshot(provider: UsageProvider, now: number): UsageSnapshot {
  const random = seeded(provider);
  const daily: DailyUsage[] = [];
  for (let back = 364; back >= 0; back--) {
    const time = now - back * 86_400_000, weekend = [0, 6].includes(new Date(time).getUTCDay());
    if (random() > (weekend ? 0.35 : 0.78)) continue;
    const totalTokens = Math.round(900_000 + random() * random() * 14_000_000);
    const inputTokens = Math.round(totalTokens * 0.62), outputTokens = totalTokens - inputTokens;
    daily.push({
      date: new Date(time).toISOString().slice(0, 10), models: [], totalTokens, inputTokens, outputTokens,
      cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: 0, unpricedTokens: 0,
      sessions: 1 + Math.floor(random() * 5), humanRequests: 4 + Math.floor(random() * 60), assistantRequests: 0,
    });
  }
  const sum = (pick: (d: DailyUsage) => number) => daily.reduce((total, d) => total + pick(d), 0);
  const totalTokens = sum((d) => d.totalTokens), sessions = sum((d) => d.sessions);
  return {
    version: 1, provider, generatedAt: new Date(now).toISOString(), source: "local", timezone: "UTC",
    coverage: { firstEvent: daily[0]?.date ?? null, lastEvent: daily.at(-1)?.date ?? null, filesScanned: 0, malformedLines: 0, warnings: [] },
    totals: {
      totalTokens, inputTokens: sum((d) => d.inputTokens), outputTokens: sum((d) => d.outputTokens), cachedInputTokens: 0,
      cacheWriteTokens: 0, reasoningTokens: 0, sessions, humanRequests: sum((d) => d.humanRequests), assistantRequests: 0,
      averageTokensPerSession: sessions ? Math.round(totalTokens / sessions) : 0, costUsd: 0, unpricedTokens: 0,
    },
    models: [], daily, hours: [], mostExpensiveDay: null, mostExpensive24h: null, pricing: { checkedAt: new Date(now).toISOString(), sources: [] },
  };
}
