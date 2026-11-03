import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectUsage } from "./collector";
import { collectClaudeUsage } from "./claude-collector";
import { collectCursorUsage } from "./cursor-collector";
import { collectAntigravityUsage } from "./antigravity-collector";
import { isCloud, readSnapshot } from "./storage";
import { PROVIDERS, providerName } from "./providers";
import { validateSnapshot } from "./validation";
import type { UsageProvider, UsageSnapshot } from "./types";

// Where the dashboard gets usage from, fast.
//
// Re-reading local history after a restart takes tens of seconds for large Codex and Claude
// folders. So the last result is kept on disk, served at once, and refreshed in the background
// (stale-while-revalidate). The dashboard polls, so fresh numbers replace it within seconds.

export type UsageResult = { snapshot: UsageSnapshot; stale: boolean };
type Collect = () => Promise<UsageSnapshot>;

const FRESH_MS = 10_000;
const OWN_COLLECTORS: Record<UsageProvider, Collect> = {
  codex: collectUsage,
  claude: collectClaudeUsage,
  cursor: collectCursorUsage,
  antigravity: collectAntigravityUsage,
};

// Next.js gives instrumentation and each route their own copy of this module, so shared
// state lives on globalThis. That includes the collectors themselves: each keeps a per-file
// parse cache, and reusing one copy keeps refreshes warm.
type Store = {
  collectors?: Record<UsageProvider, Collect>;
  snapshots: Map<UsageProvider, UsageSnapshot>;
  refreshedAt: Map<UsageProvider, number>;
  pending: Map<UsageProvider, Promise<UsageSnapshot>>;
  failed: Map<UsageProvider, Error>;
};
const globalStore = globalThis as typeof globalThis & { __vibeCheckUsage?: Store };
const store = (): Store =>
  (globalStore.__vibeCheckUsage ??= {
    snapshots: new Map(),
    refreshedAt: new Map(),
    pending: new Map(),
    failed: new Map(),
  });

// In development the calling copy is used, so edits to a collector apply without a restart.
const collectorFor = (provider: UsageProvider) =>
  process.env.NODE_ENV === "development"
    ? OWN_COLLECTORS[provider]
    : (store().collectors ??= OWN_COLLECTORS)[provider];

// The disk copy sits beside the other private snapshots in data/, which is never deployed.
const cacheFile = (provider: UsageProvider) =>
  path.join(process.cwd(), "data", "dashboard-cache", `${provider}.json`);

async function readDiskCache(provider: UsageProvider) {
  try {
    const snapshot = validateSnapshot(JSON.parse(await readFile(cacheFile(provider), "utf8")));
    return (snapshot.provider || "codex") === provider ? snapshot : null;
  } catch {
    return null; // Missing or unreadable: collect as if it never existed.
  }
}

async function writeDiskCache(snapshot: UsageSnapshot) {
  const file = cacheFile(snapshot.provider || "codex");
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(tmp, file);
}

// One collection per provider at a time; every caller shares it.
export function refreshLocalUsage(provider: UsageProvider) {
  const s = store();
  let job = s.pending.get(provider);
  if (job) return job;
  job = collectorFor(provider)()
    .then((snapshot) => {
      s.snapshots.set(provider, snapshot);
      s.refreshedAt.set(provider, Date.now());
      s.failed.delete(provider);
      void writeDiskCache(snapshot).catch(() => {});
      return snapshot;
    })
    .catch((error: unknown) => {
      s.failed.set(provider, error instanceof Error ? error : new Error("Collection failed."));
      throw error;
    })
    .finally(() => s.pending.delete(provider));
  s.pending.set(provider, job);
  return job;
}

async function cachedLocalUsage(provider: UsageProvider) {
  const s = store();
  let snapshot = s.snapshots.get(provider);
  if (!snapshot) {
    snapshot = (await readDiskCache(provider)) ?? undefined;
    // Another caller may have finished collecting while the file was read.
    if (snapshot && !s.snapshots.has(provider)) s.snapshots.set(provider, snapshot);
    snapshot = s.snapshots.get(provider);
  }
  return snapshot;
}

// Local usage for the API. Returns the cached result at once when there is one; waits only
// when nothing has ever been collected.
export async function localUsage(provider: UsageProvider): Promise<UsageResult> {
  const s = store();
  const snapshot = await cachedLocalUsage(provider);
  const age = Date.now() - (s.refreshedAt.get(provider) ?? 0);
  if (!snapshot) return { snapshot: await refreshLocalUsage(provider), stale: false };
  if (age > FRESH_MS) {
    // Report a failure from the last attempt so the dashboard can say so, but keep retrying.
    const failure = s.pending.has(provider) ? undefined : s.failed.get(provider);
    void refreshLocalUsage(provider).catch(() => {});
    if (failure) throw failure;
  }
  return { snapshot, stale: !s.refreshedAt.has(provider) };
}

// Warm providers in the background when the local server starts, one at a time so page
// requests are not starved of CPU. In development routes collect with their own copy of the
// collectors (see collectorFor), so only providers with nothing saved yet are worth warming.
export async function prewarmLocalUsage() {
  if (isCloud()) return;
  for (const provider of PROVIDERS) {
    const saved = await cachedLocalUsage(provider);
    if (saved && process.env.NODE_ENV === "development") continue;
    await refreshLocalUsage(provider).catch(() => {});
  }
}

export class MissingCloudSnapshot extends Error {
  constructor(provider: UsageProvider) {
    super(`No ${providerName(provider)} cloud snapshot yet. Run the collector with --provider ${provider} to upload usage.`);
  }
}

export async function cloudUsage(provider: UsageProvider): Promise<UsageResult> {
  const snapshot = await readSnapshot(provider);
  if (!snapshot) throw new MissingCloudSnapshot(provider);
  if ((snapshot.provider || "codex") !== provider) throw new Error("Stored snapshot provider mismatch.");
  return { snapshot: { ...snapshot, source: "cloud" }, stale: false };
}

export const usageFor = (provider: UsageProvider) =>
  isCloud() ? cloudUsage(provider) : localUsage(provider);

// For server-rendering a dashboard: whatever is ready right now, never a slow collection.
// null means the page falls back to loading in the browser, exactly as before.
export async function readyUsage(provider: UsageProvider): Promise<UsageResult | { error: string } | null> {
  try {
    if (isCloud()) return await cloudUsage(provider);
    if (!(await cachedLocalUsage(provider))) return null;
    return await localUsage(provider);
  } catch (error) {
    return error instanceof MissingCloudSnapshot ? { error: error.message } : null;
  }
}
