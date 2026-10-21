export type UsageProvider = "codex" | "claude" | "cursor" | "antigravity";

export interface TokenTotals {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}
export interface ModelUsage extends TokenTotals {
  model: string;
  costUsd: number;
  requests: number;
  priced: boolean;
  unpricedTokens: number;
}
export interface DailyUsage extends TokenTotals {
  date: string;
  models: ModelUsage[];
  sessions: number;
  humanRequests: number;
  assistantRequests: number;
  costUsd: number;
  unpricedTokens: number;
}
export interface MetricAvailability {
  tokens: boolean;
  cost: boolean;
  sessions: boolean;
  humanRequests: boolean;
  assistantRequests: boolean;
  cacheBreakdown: boolean;
}
export interface UsageSnapshot {
  // Absence preserves the original fully recorded metric contract.
  availability?: MetricAvailability;
  // Missing provider identifies legacy Codex v1 snapshots.
  provider?: UsageProvider;
  version: 1;
  generatedAt: string;
  source: "local" | "cloud";
  timezone: string;
  coverage: {
    firstEvent: string | null;
    lastEvent: string | null;
    filesScanned: number;
    malformedLines: number;
    warnings: string[];
  };
  totals: TokenTotals & {
    sessions: number;
    humanRequests: number;
    assistantRequests: number;
    averageTokensPerSession: number;
    costUsd: number;
    unpricedTokens: number;
  };
  models: ModelUsage[];
  daily: DailyUsage[];
  hours: { hour: number; tokens: number; requests: number }[];
  mostExpensiveDay: { date: string; costUsd: number; tokens: number } | null;
  mostExpensive24h: {
    start: string;
    end: string;
    costUsd: number;
    tokens: number;
  } | null;
  pricing: { checkedAt: string; sources: string[] };
}
