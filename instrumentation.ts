// Runs once when the server starts. On a local copy, read usage history in the background so
// the first dashboard visit does not wait for it. Never awaited: Next.js holds requests until
// register() resolves.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Deployed copies read uploaded snapshots; never load the collectors there.
  const { isCloud } = await import("./lib/mode");
  if (isCloud()) return;
  const { prewarmLocalUsage } = await import("./lib/usage-source");
  void prewarmLocalUsage().catch(() => {});
}
