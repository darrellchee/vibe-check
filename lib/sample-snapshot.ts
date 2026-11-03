import type { DailyUsage, ModelUsage, UsageProvider, UsageSnapshot } from "./types";

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

// Made-up model splits, so the model cards have something to draw.
const SAMPLE_MODELS: Record<UsageProvider, [string, number][]> = {
  codex: [["gpt-5-codex", 0.46], ["gpt-5", 0.24], ["gpt-5-mini", 0.12], ["o3", 0.08], ["gpt-4.1", 0.05], ["o4-mini", 0.03], ["gpt-4o", 0.01], ["codex-mini", 0.01]],
  claude: [["claude-sonnet-4-5", 0.52], ["claude-opus-4-1", 0.28], ["claude-haiku-4-5", 0.14], ["claude-sonnet-4", 0.06]],
  cursor: [["auto", 0.4], ["claude-sonnet-4-5", 0.3], ["gpt-5", 0.18], ["composer-1", 0.12]],
  antigravity: [["gemini-3-pro", 0.62], ["gemini-2.5-flash", 0.23], ["claude-sonnet-4-5", 0.15]],
};
function sampleModels(provider: UsageProvider, totalTokens: number, costUsd: number): ModelUsage[] {
  const split = SAMPLE_MODELS[provider];
  let left = totalTokens;
  return split.map(([model, share], i) => {
    const total = i === split.length - 1 ? left : Math.round(totalTokens * share);
    left -= total;
    const input = Math.round(total * 0.62);
    return {
      model, totalTokens: total, inputTokens: input, cachedInputTokens: Math.round(input * 0.7), cacheWriteTokens: 0, outputTokens: total - input,
      reasoningTokens: 0, costUsd: Math.round(costUsd * share * 100) / 100, requests: 0, priced: true, unpricedTokens: 0,
    };
  });
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
      cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: Math.round(totalTokens / 1e6 * 140) / 100, unpricedTokens: 0,
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
      averageTokensPerSession: sessions ? Math.round(totalTokens / sessions) : 0, costUsd: sum((d) => d.costUsd), unpricedTokens: 0,
    },
    models: sampleModels(provider, totalTokens, sum((d) => d.costUsd)), daily, hours: [], mostExpensiveDay: null, mostExpensive24h: null, pricing: { checkedAt: new Date(now).toISOString(), sources: [] },
  };
}
