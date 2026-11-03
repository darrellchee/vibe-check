import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { UsageProvider, UsageSnapshot } from "./types";
import { kv, storageBackend } from "./kv";
import { isCloud } from "./mode";
const storageKey = (provider: UsageProvider) => `${provider}-vibe-check:snapshot:v1`;
// Sites deployed before the rename stored snapshots here. It is read until the first new upload.
const legacyStorageKey = (provider: UsageProvider) => `${provider}-atlas:snapshot:v1`;
const snapshotFile = (provider: UsageProvider) =>
  provider === "codex" ? "snapshot.json" : `${provider}-snapshot.json`;
// A database is connected when one integration's variables are fully set. See lib/kv.ts.
export function storageConfigured() {
  try {
    return storageBackend() !== null;
  } catch {
    return false;
  }
}
// Kept in its own dependency-free module so the startup hook can check it cheaply.
export { isCloud } from "./mode";
export async function readSnapshot(
  provider: UsageProvider = "codex",
): Promise<UsageSnapshot | null> {
  if (isCloud()) {
    const value = (await kv().get(storageKey(provider))) ?? (await kv().get(legacyStorageKey(provider)));
    return value ? JSON.parse(value) : null;
  }
  try {
    return JSON.parse(
      await readFile(
        path.join(process.cwd(), "data", snapshotFile(provider)),
        "utf8",
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function saveSnapshot(snapshot: UsageSnapshot) {
  const provider = snapshot.provider || "codex";
  if (isCloud()) {
    // Atomic compare-and-replace, so slow collectors cannot overwrite newer data.
    return kv().putIfNewer(storageKey(provider), snapshot.generatedAt, JSON.stringify(snapshot));
  }
  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `snapshot-${crypto.randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(tmp, path.join(dir, snapshotFile(provider)));
  return true;
}
