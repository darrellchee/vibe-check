import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { UsageProvider, UsageSnapshot } from "./types";
const storageKey = (provider: UsageProvider) => `${provider}-atlas:snapshot:v1`;
const snapshotFile = (provider: UsageProvider) =>
  provider === "codex" ? "snapshot.json" : `${provider}-snapshot.json`;
function config() {
  // Vercel's Upstash integration injects KV_REST_API_*; self-managed setups use UPSTASH_REDIS_REST_*.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token =
      process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (Boolean(url) !== Boolean(token))
    throw new Error("Both Upstash environment variables are required.");
  if (url && !url.startsWith("https://"))
    throw new Error("Cloud storage requires HTTPS.");
  return url && token ? { url, token } : null;
}
export function storageConfigured() {
  try {
    return config() !== null;
  } catch {
    return false;
  }
}
export function isCloud() {
  const mode = process.env.ATLAS_MODE;
  if (mode === "cloud") return true;
  if (mode === "local") return false;
  // Vercel sets VERCEL=1 at runtime, so a deployed copy needs no mode setting.
  return process.env.VERCEL === "1";
}
export async function redis(command: unknown[]) {
  const c = config();
  if (!c)
    throw new Error(
      "Cloud storage is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  const response = await fetch(c.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Cloud storage is unavailable.");
  const result = await response.json();
  if (result.error) throw new Error("Cloud storage rejected the operation.");
  return result.result;
}
export async function readSnapshot(
  provider: UsageProvider = "codex",
): Promise<UsageSnapshot | null> {
  if (isCloud()) {
    const value = await redis(["GET", storageKey(provider)]);
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
    // Compare and replace atomically so slow collectors cannot overwrite newer data.
    const script =
      "local old = redis.call('GET', KEYS[1]); if old then local parsed = cjson.decode(old); if parsed.generatedAt >= ARGV[1] then return 0 end end; redis.call('SET', KEYS[1], ARGV[2]); return 1";
    const saved = await redis([
      "EVAL",
      script,
      1,
      storageKey(provider),
      snapshot.generatedAt,
      JSON.stringify(snapshot),
    ]);
    return saved === 1;
  }
  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `snapshot-${crypto.randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(tmp, path.join(dir, snapshotFile(provider)));
  return true;
}
