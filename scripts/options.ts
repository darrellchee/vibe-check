import type { UsageProvider } from "../lib/types";

export function collectionOptions(args: string[], allowWatch = false) {
  let selected: UsageProvider | "all" = "codex";
  let providerSeen = false;
  let watch = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--watch" && allowWatch && !watch) {
      watch = true;
      continue;
    }
    if (
      (arg === "--provider" || arg.startsWith("--provider=")) &&
      !providerSeen
    ) {
      const value = arg === "--provider" ? args[++index] : arg.slice(11);
      if (value !== "codex" && value !== "claude" && value !== "cursor" && value !== "antigravity" && value !== "all")
        throw new Error(
          "Use --provider codex, --provider claude, --provider cursor, --provider antigravity, or --provider all.",
        );
      selected = value;
      providerSeen = true;
      continue;
    }
    throw new Error(
      `Use --provider codex|claude|cursor|antigravity|all${allowWatch ? " and optionally --watch" : ""}. Configure credentials in the environment, not command arguments.`,
    );
  }
  const providers: UsageProvider[] =
    selected === "all" ? ["codex", "claude", "cursor", "antigravity"] : [selected];
  return { providers, watch };
}
