// Readable model names: "claude-opus-4-1-20250805" becomes "Claude Opus 4.1", "gpt-5-codex" becomes
// "GPT-5 Codex". Anything unrecognised is shown as recorded.
export const modelLabel = (s: string) => {
  const claude = s.match(
    /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/,
  );
  if (claude)
    return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? "." + claude[3] : ""}`;
  return s
    .replace(/^gpt-/, "GPT-")
    .replace(/-codex/g, " Codex")
    .replace(
      /-(sol|astra|luna|terra)/g,
      (_, x: string) => ` ${x[0].toUpperCase()}${x.slice(1)}`,
    );
};
