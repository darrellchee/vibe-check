import type { CardProvider, UsageProvider } from "./types";
export const PROVIDERS: UsageProvider[] = ["codex", "claude", "cursor", "antigravity"];
export const CARD_PROVIDERS: CardProvider[] = ["all", ...PROVIDERS];
export const isCardProvider = (value: unknown): value is CardProvider => CARD_PROVIDERS.includes(value as CardProvider);
// Like providerFromUrl, but the public card endpoint also accepts provider=all.
export function cardProviderFromUrl(url: string): CardProvider {
  const values = new URL(url).searchParams.getAll("provider");
  if (values.length === 0) return "codex";
  if (values.length !== 1 || !isCardProvider(values[0]))
    throw new Error("Unknown usage provider. Choose all, codex, claude, cursor or antigravity.");
  return values[0];
}
export function providerFromUrl(url: string): UsageProvider {
  const values = new URL(url).searchParams.getAll("provider");
  if (values.length === 0) return "codex";
  if (values.length !== 1 || !PROVIDERS.includes(values[0] as UsageProvider))
    throw new Error("Unknown usage provider. Choose codex, claude, cursor or antigravity.");
  return values[0] as UsageProvider;
}
export const providerName = (provider: CardProvider) =>
  ({ all: "All", codex: "Codex", claude: "Claude Code", cursor: "Cursor", antigravity: "Antigravity" })[provider];
// Env var that explicitly enables or disables a provider's public card.
export const widgetFlag = (provider: UsageProvider) =>
  provider === "codex" ? "PUBLIC_WIDGET" : `PUBLIC_${provider.toUpperCase()}_WIDGET`;
