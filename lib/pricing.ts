import type { TokenTotals } from "./types";

// USD per million tokens, Standard API-equivalent rates verified 2026-10-19.
export const PRICING_SOURCES = [
  "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
  "https://developers.openai.com/api/docs/pricing",
  "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
  "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
  "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
  "https://developers.openai.com/api/docs/models/gpt-5.1-codex",
  "https://developers.openai.com/api/docs/models/gpt-5.4",
  "https://developers.openai.com/api/docs/models/gpt-5.5",
];
export const PRICING_CHECKED_AT = "2026-10-19";
type Rate = {
  input: number;
  cached: number;
  write: number;
  output: number;
  longContext?: boolean;
};
export const RATES: Record<string, Rate> = {
  "gpt-6.1-sol": {
    input: 2,
    cached: 0.1,
    write: 2.5,
    output: 10,
    longContext: true,
  },
  "gpt-6-astra": {
    input: 10,
    cached: 1,
    write: 12.5,
    output: 50,
    longContext: true,
  },
  "gpt-6-sol": {
    input: 2,
    cached: 0.2,
    write: 2.5,
    output: 10,
    longContext: true,
  },
  "gpt-6-luna": {
    input: 0.1,
    cached: 0.01,
    write: 0.125,
    output: 0.5,
    longContext: true,
  },
  "gpt-5.6-sol": {
    input: 4,
    cached: 0.4,
    write: 5,
    output: 20,
    longContext: true,
  },
  "gpt-5.6": { input: 4, cached: 0.4, write: 5, output: 20, longContext: true },
  "gpt-5.6-terra": {
    input: 2,
    cached: 0.2,
    write: 2.5,
    output: 12,
    longContext: true,
  },
  "gpt-5.6-luna": {
    input: 0.2,
    cached: 0.02,
    write: 0.25,
    output: 1.2,
    longContext: true,
  },
  // Hidden Codex model with no published API price; billed at the closest
  // "fast and affordable" tier (gpt-5.6-luna) as an explicit assumption.
  "gpt-reserve": {
    input: 0.2,
    cached: 0.02,
    write: 0.25,
    output: 1.2,
    longContext: true,
  },
  "gpt-5.3-codex": { input: 1.75, cached: 0.175, write: 1.75, output: 14 },
  "gpt-5.1-codex": { input: 1.25, cached: 0.125, write: 1.25, output: 10 },
  "gpt-5.4": {
    input: 2.5,
    cached: 0.25,
    write: 2.5,
    output: 15,
    longContext: true,
  },
  "gpt-5.5": { input: 5, cached: 0.5, write: 5, output: 30, longContext: true },
};

export function estimateCost(
  model: string,
  tokens: TokenTotals,
  tier?: string,
): number | null {
  const rate = RATES[model];
  if (!rate) return null;
  const long = rate.longContext && tokens.inputTokens > 272_000;
  const multiplier =
    tier === "fast" || tier === "priority"
      ? 2
      : tier === "ultrafast"
        ? 6
        : tier === "batch" || tier === "flex"
          ? 0.5
          : 1;
  const ordinary = Math.max(
    0,
    tokens.inputTokens - tokens.cachedInputTokens - tokens.cacheWriteTokens,
  );
  return (
    (((ordinary * rate.input +
      tokens.cachedInputTokens * rate.cached +
      tokens.cacheWriteTokens * rate.write) *
      (long ? 2 : 1) +
      tokens.outputTokens * rate.output * (long ? 1.5 : 1)) /
      1_000_000) *
    multiplier
  );
}
