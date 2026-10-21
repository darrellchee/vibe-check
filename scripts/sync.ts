import { setTimeout as delay } from "node:timers/promises";
import { collectUsage } from "../lib/collector";
import { collectClaudeUsage } from "../lib/claude-collector";
import { collectCursorUsage } from "../lib/cursor-collector";
import { collectAntigravityUsage } from "../lib/antigravity-collector";
import { collectionOptions } from "./options";

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const { providers, watch } = collectionOptions(process.argv.slice(2), true);
  let target: URL;
  try {
    target = new URL(process.env.SYNC_URL || "");
  } catch {
    throw new Error("Set SYNC_URL to your dashboard base URL.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && local))
    throw new Error(
      "SYNC_URL requires HTTPS, except for localhost development.",
    );
  if (target.username || target.password || target.search || target.hash)
    throw new Error(
      "SYNC_URL must be a base URL without credentials, query, or fragment.",
    );
  const token = process.env.SYNC_TOKEN;
  if (!token || token.length < 32)
    throw new Error("SYNC_TOKEN must contain at least 32 characters.");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    do {
      for (const provider of providers) {
        try {
          const endpoint = new URL("/api/ingest", target);
          endpoint.searchParams.set("provider", provider);
          const snapshot = await (provider === "antigravity"
            ? collectAntigravityUsage()
            : provider === "cursor"
              ? collectCursorUsage()
              : provider === "claude"
              ? collectClaudeUsage()
              : collectUsage());
          if (controller.signal.aborted) break;
          const response = await fetch(endpoint, {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(snapshot),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(30_000),
            ]),
          });
          // Never print response bodies: a misconfigured endpoint could echo secrets.
          await response.body?.cancel();
          if (!response.ok)
            throw new Error("Sync endpoint rejected the snapshot.");
          console.log(
            `Synced ${provider} aggregate snapshot at ${snapshot.generatedAt}.`,
          );
        } catch {
          if (controller.signal.aborted) break;
          console.error(
            `Sync failed for ${provider}. Check collector access, endpoint settings, credentials, and cloud storage.`,
          );
          if (!watch) process.exitCode = 1;
        }
      }
      if (watch) {
        try {
          await delay(30_000, undefined, { signal: controller.signal });
        } catch {
          break;
        }
      }
    } while (watch && !controller.signal.aborted);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch((error) => {
  // Only our configuration errors reach here; network errors are handled above.
  console.error(
    error instanceof Error &&
      /^(Use --provider|Set SYNC|SYNC_)/.test(error.message)
      ? error.message
      : "Sync configuration could not be loaded.",
  );
  process.exitCode = 1;
});
