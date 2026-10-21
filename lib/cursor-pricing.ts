import type { TokenTotals } from "./types";
import { RATES, PRICING_SOURCES } from "./pricing";
import {
  CLAUDE_RATES,
  canonicalClaudeModel,
  CLAUDE_PRICING_SOURCES,
} from "./claude-pricing";

export const CURSOR_PRICING_CHECKED_AT = "2026-10-20";
export const CURSOR_PRICING_SOURCES = [
  ...PRICING_SOURCES,
  ...CLAUDE_PRICING_SOURCES,
  "https://cursor.com/docs/models/claude-4-sonnet",
  "https://cursor.com/docs/models-and-pricing",
];
const CLAUDE_ALIASES: Record<string, string> = {
  "claude-4-sonnet": "claude-sonnet-4",
  "claude-4.5-sonnet-thinking": "claude-sonnet-4-5",
  "claude-4.5-opus-high-thinking": "claude-opus-4-5",
  "claude-4.6-opus-high-thinking": "claude-opus-4-6",
};
// Cursor's first-party Composer 1 has no provider API. Third-party reviews put
// it at $1.25 input / $10 output per 1M tokens, "priced the same as GPT-5", so
// cache read uses GPT-5's 10% rate ($0.125) and cache writes bill as input.
// No source lists a Composer-specific cache rate; that part is an assumption.
// Sources (third-party, so kept out of CURSOR_PRICING_SOURCES, whose hosts the
// ingest validator restricts to first-party providers):
//   https://www.cometapi.com/how-much-does-cursor-composer-cost/
//   https://composio.dev/content/cursor-composer-1-vs-claude-4-5-sonnet-the-better-coding-model
const COMPOSER_RATES: Record<
  string,
  { input: number; cached: number; write: number; output: number }
> = {
  "composer-1": { input: 1.25, cached: 0.125, write: 1.25, output: 10 },
};
export function estimateCursorCost(
  model: string,
  tokens: TokenTotals,
): number | null {
  const canonical = CLAUDE_ALIASES[model] || model;
  const ordinary = Math.max(
    0,
    tokens.inputTokens - tokens.cachedInputTokens - tokens.cacheWriteTokens,
  );
  if (canonical.startsWith("claude-")) {
    const rate = CLAUDE_RATES[canonicalClaudeModel(canonical)];
    if (!rate) return null;
    return (
      (ordinary * rate.input +
        tokens.cachedInputTokens * rate.cached +
        tokens.cacheWriteTokens * rate.input * 1.25 +
        tokens.outputTokens * rate.output) /
      1_000_000
    );
  }
  const rate = RATES[canonical] || COMPOSER_RATES[canonical];
  if (!rate) return null;
  // Cursor export rows can aggregate underlying requests. Do not infer a
  // per-request context-length tier from an aggregate row's token count.
  return (
    (ordinary * rate.input +
      tokens.cachedInputTokens * rate.cached +
      tokens.cacheWriteTokens * rate.write +
      tokens.outputTokens * rate.output) /
    1_000_000
  );
}
