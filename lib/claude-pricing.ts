import type { TokenTotals } from "./types";

export const CLAUDE_PRICING_CHECKED_AT = "2026-10-19";
export const CLAUDE_PRICING_SOURCES = [
  "https://platform.claude.com/docs/en/about-claude/pricing",
  "https://platform.claude.com/docs/en/build-with-claude/prompt-caching",
];
type Rate = { input: number; output: number; cached: number };
export const CLAUDE_RATES: Record<string, Rate> = {
  "claude-fable-5-1": { input: 10, output: 50, cached: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, cached: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cached: 1 },
  "claude-mythos-5": { input: 10, output: 50, cached: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cached: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cached: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cached: 0.01 },
  "claude-opus-5": { input: 5, output: 25, cached: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cached: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cached: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cached: 0.5 },
  "claude-opus-4-5": { input: 5, output: 25, cached: 0.5 },
  "claude-opus-4-1": { input: 15, output: 75, cached: 1.5 },
  "claude-opus-4": { input: 15, output: 75, cached: 1.5 },
  "claude-sonnet-5": { input: 2, output: 10, cached: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cached: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cached: 0.3 },
  "claude-sonnet-4": { input: 3, output: 15, cached: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cached: 0.1 },
  "claude-3-5-haiku": { input: 0.8, output: 4, cached: 0.08 },
};
export function canonicalClaudeModel(model: string): string {
  // Published dated snapshots share their underlying family's current price.
  return model.replace(/-\d{8}$/, "");
}
export function estimateClaudeCost(
  model: string,
  tokens: TokenTotals,
  details: {
    write1hTokens?: number;
    speed?: string;
    serviceTier?: string;
    inferenceGeo?: string;
  } = {},
): number | null {
  const canonical = canonicalClaudeModel(model);
  let rate = CLAUDE_RATES[canonical];
  if (!rate) return null;
  if (canonical === "claude-haiku-5-5" && tokens.inputTokens > 100_000)
    rate = { input: 0.5, output: 2.5, cached: 0.05 };
  const oneHour = Math.min(
    tokens.cacheWriteTokens,
    Math.max(0, details.write1hTokens || 0),
  );
  const ordinary = Math.max(
    0,
    tokens.inputTokens - tokens.cachedInputTokens - tokens.cacheWriteTokens,
  );
  const fastModels = ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"];
  const speed =
    details.speed === "fast" && fastModels.includes(canonical)
      ? 2
      : details.serviceTier === "batch"
        ? 0.5
        : 1;
  const region = details.inferenceGeo === "us" ? 1.1 : 1;
  return (
    ((ordinary * rate.input +
      tokens.cachedInputTokens * rate.cached +
      (tokens.cacheWriteTokens - oneHour) * rate.input * 1.25 +
      oneHour * rate.input * 2 +
      tokens.outputTokens * rate.output) /
      1_000_000) *
    speed *
    region
  );
}
