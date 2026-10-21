import type { TokenTotals } from "./types";
import { CLAUDE_PRICING_SOURCES, estimateClaudeCost } from "./claude-pricing";

export const ANTIGRAVITY_PRICING_CHECKED_AT = "2026-10-21";
export const ANTIGRAVITY_PRICING_SOURCES = [
  "https://ai.google.dev/gemini-api/docs/pricing",
  "https://antigravity.google/docs/plans",
  ...CLAUDE_PRICING_SOURCES,
];

type Rate = { input: number; cached: number; output: number };
// Google publishes one output rate that already includes thinking tokens, and
// bills cached input at the cache-read rate. Both Flash prices are
// listed through 2026-12-31 and double on 2027-01-01.
const FLASH_NOW: Rate = { input: 0.75, cached: 0.075, output: 3.75 };
const FLASH_2027: Rate = { input: 1.5, cached: 0.15, output: 7.5 };
const PRICE_CHANGE = Date.parse("2027-01-01T00:00:00Z");
const GEMINI_OFFICIAL = new Set(["gemini-3.6-flash", "gemini-3.8-flash"]);
// Rates for models Google does not list on its API pricing page. These come
// from third-party price quotes (not an official source) and the cached rate is
// assumed to be 10% of input, the ratio Google uses for 3.6 and 3.8 Flash.
const GEMINI_QUOTED: Record<string, Rate> = {
  "gemini-3.7-flash": { input: 0.75, cached: 0.075, output: 3.75 },
  "gemini-3.5-flash-high": { input: 1.5, cached: 0.15, output: 9 },
  "gemini-3.5-flash-medium": { input: 1.5, cached: 0.15, output: 9 },
};

/** Antigravity labels and enums mapped to the name shown on the dashboard. */
const LABELS: Record<string, string> = {
  "gemini-3-flash-a": "gemini-3.5-flash-high",
  "gemini-default": "gemini-3.5-flash-medium",
  "gemini-3.7-flash-tiered": "gemini-3.7-flash",
  "claude-opus-4-6-thinking": "claude-opus-4-6",
};
const ENUMS: Record<number, string> = {
  1020: "gemini-3.5-flash-medium",
  1026: "claude-opus-4-6",
  1071: "gemini-3.6-flash",
  1132: "gemini-3.5-flash-high",
  1301: "gemini-3.7-flash",
  1318: "gemini-3.8-flash",
  1319: "gemini-3.8-flash",
};

export function antigravityModelName(
  label: string | undefined,
  modelEnum: number,
): string {
  if (label) return LABELS[label] || label.toLowerCase();
  if (ENUMS[modelEnum]) return ENUMS[modelEnum];
  return modelEnum ? `antigravity-model-${modelEnum}` : "unknown";
}

/**
 * API-equivalent replacement value. Unknown models return null and stay
 * unpriced rather than borrowing a neighbouring model's rate. Cache-write
 * tokens are not recorded by Antigravity, so Claude figures are a lower bound.
 */
export function estimateAntigravityCost(
  model: string,
  tokens: TokenTotals,
  now: Date = new Date(),
): number | null {
  if (model.startsWith("claude-")) return estimateClaudeCost(model, tokens);
  const rate = GEMINI_OFFICIAL.has(model)
    ? now.getTime() >= PRICE_CHANGE
      ? FLASH_2027
      : FLASH_NOW
    : GEMINI_QUOTED[model];
  if (!rate) return null;
  const uncached = Math.max(0, tokens.inputTokens - tokens.cachedInputTokens);
  // outputTokens already includes thinking; never add reasoningTokens again.
  return (
    (uncached * rate.input +
      tokens.cachedInputTokens * rate.cached +
      tokens.outputTokens * rate.output) /
    1_000_000
  );
}
