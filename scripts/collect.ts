import { collectUsage } from "../lib/collector";
import { collectClaudeUsage } from "../lib/claude-collector";
import { collectCursorUsage } from "../lib/cursor-collector";
import { collectAntigravityUsage } from "../lib/antigravity-collector";
import { saveSnapshot } from "../lib/storage";
import { collectionOptions } from "./options";

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Collection always writes locally, even when this checkout also has cloud settings.
  process.env.ATLAS_MODE = "local";
  const { providers } = collectionOptions(process.argv.slice(2));
  for (const provider of providers) {
    try {
      const snapshot = await (provider === "antigravity"
        ? collectAntigravityUsage()
        : provider === "cursor"
          ? collectCursorUsage()
          : provider === "claude"
          ? collectClaudeUsage()
          : collectUsage());
      await saveSnapshot(snapshot);
      console.log(
        `Saved private ${provider} aggregate snapshot: ${snapshot.availability?.sessions === false ? "sessions unavailable" : `${snapshot.totals.sessions} sessions`}, ${snapshot.models.length} models, ${snapshot.coverage.filesScanned} files scanned.`,
      );
    } catch {
      console.error(
        `Collection failed for ${provider}. Check local history permissions and USAGE_TIMEZONE.`,
      );
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error && error.message.startsWith("Use --provider")
      ? error.message
      : "Collection configuration could not be loaded.",
  );
  process.exitCode = 1;
});
