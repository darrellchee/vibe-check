import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectUsage } from "../lib/collector";
import { localUsage, readyUsage, refreshLocalUsage } from "../lib/usage-source";

// Each test runs in its own folder (the disk cache lives under ./data) with an empty Codex home,
// so collection is quick and never touches real history.
async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), "vibe-check-usage-source-"));
  const env: Record<string, string | undefined> = process.env;
  const before = { cwd: process.cwd(), CODEX_HOME: env.CODEX_HOME, VIBE_CHECK_MODE: env.VIBE_CHECK_MODE };
  process.chdir(dir);
  env.CODEX_HOME = path.join(dir, "codex-home");
  env.VIBE_CHECK_MODE = "local";
  delete (globalThis as { __vibeCheckUsage?: unknown }).__vibeCheckUsage;
  return {
    dir,
    async restore() {
      process.chdir(before.cwd);
      for (const key of ["CODEX_HOME", "VIBE_CHECK_MODE"] as const)
        if (before[key] === undefined) delete env[key];
        else env[key] = before[key];
      delete (globalThis as { __vibeCheckUsage?: unknown }).__vibeCheckUsage;
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }); // A background save may still be landing.
    },
  };
}

test("a copy saved by an earlier run is served at once, then replaced by fresh usage", async () => {
  const box = await sandbox();
  try {
    const saved = { ...(await collectUsage(path.join(box.dir, "missing"))), generatedAt: "2026-10-01T00:00:00.000Z" };
    await mkdir(path.join(box.dir, "data", "dashboard-cache"), { recursive: true });
    await writeFile(path.join(box.dir, "data", "dashboard-cache", "codex.json"), JSON.stringify(saved));

    const first = await localUsage("codex");
    assert.equal(first.stale, true);
    assert.equal(first.snapshot.generatedAt, saved.generatedAt);

    await refreshLocalUsage("codex"); // Joins the background refresh the first call started.
    const second = await localUsage("codex");
    assert.equal(second.stale, false);
    assert.notEqual(second.snapshot.generatedAt, saved.generatedAt);

    // The fresh result is saved owner-only for the next start.
    const file = path.join(box.dir, "data", "dashboard-cache", "codex.json");
    for (let i = 0; i < 50 && JSON.parse(await readFile(file, "utf8")).generatedAt === saved.generatedAt; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(JSON.parse(await readFile(file, "utf8")).generatedAt, second.snapshot.generatedAt);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await box.restore();
  }
});

test("server rendering never waits for a first collection, and ignores unreadable caches", async () => {
  const box = await sandbox();
  try {
    assert.equal(await readyUsage("codex"), null);
    await mkdir(path.join(box.dir, "data", "dashboard-cache"), { recursive: true });
    await writeFile(path.join(box.dir, "data", "dashboard-cache", "claude.json"), "{ not json");
    assert.equal(await readyUsage("claude"), null);
    // A cache holding another provider's usage is never shown under this one.
    await writeFile(path.join(box.dir, "data", "dashboard-cache", "cursor.json"),
      JSON.stringify(await collectUsage(path.join(box.dir, "missing"))));
    assert.equal(await readyUsage("cursor"), null);
  } finally {
    await box.restore();
  }
});

test("the first ever visit waits for collection instead of showing nothing", async () => {
  const box = await sandbox();
  try {
    const result = await localUsage("codex");
    assert.equal(result.stale, false);
    assert.equal(result.snapshot.provider || "codex", "codex"); // Codex snapshots leave provider unset.
  } finally {
    await box.restore();
  }
});
