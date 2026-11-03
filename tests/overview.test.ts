import test from "node:test";
import assert from "node:assert/strict";
import { collectUsage } from "../lib/collector";
import { biggestWindow, combineSnapshots, hasHistory, loadHarnesses, mergeHarnesses, summarizeHarnesses } from "../lib/overview";
import { PROVIDERS } from "../lib/providers";
import type { UsageProvider, UsageSnapshot } from "../lib/types";

async function fixture(provider: UsageProvider, tokens = 100): Promise<UsageSnapshot> {
  const empty = await collectUsage(`/tmp/vibe-check-overview-missing-${process.pid}`);
  return {
    ...empty, provider,
    coverage: { ...empty.coverage, firstEvent: "2026-10-19T12:00:00Z", lastEvent: "2026-10-21T12:00:00Z" },
    totals: { ...empty.totals, totalTokens: tokens, costUsd: 2, sessions: 3, humanRequests: 4 },
    daily: ["2026-10-19", "2026-10-21"].map((date) => ({
      ...empty.totals, date, totalTokens: tokens / 2, models: [],
    })),
  };
}

test("All sums four harnesses, aligns dates and fills missing days without changing source data", async () => {
  const harnesses = await Promise.all(PROVIDERS.map(async (provider, index) => ({ provider, snapshot: await fixture(provider, (index + 1) * 100) })));
  const before = JSON.stringify(harnesses);
  const summary = summarizeHarnesses(harnesses);
  assert.equal(summary.connected.length, 4);
  assert.equal(summary.tokens, 1000);
  assert.equal(summary.cost, 8);
  assert.equal(summary.sessions, 12);
  assert.equal(summary.requests, 16);
  assert.equal(summary.reporting("tokens"), 4);
  assert.deepEqual(summary.daily.map((day) => day.date), ["2026-10-19", "2026-10-20", "2026-10-21"]);
  assert.equal(summary.daily[0].codex, 50);
  assert.equal(summary.daily[0].antigravity, 200);
  assert.equal(summary.daily[1].cursor, 0);
  assert.equal(JSON.stringify(harnesses), before);
});

test("Unavailable metrics and empty history do not become reported zero usage", async () => {
  const codex = await fixture("codex");
  delete codex.provider; // Legacy snapshots still count as Codex.
  const cursor = await fixture("cursor", 999);
  cursor.availability = { tokens: false, cost: false, sessions: true, humanRequests: true, assistantRequests: false, cacheBreakdown: false };
  const empty = await collectUsage(`/tmp/vibe-check-overview-empty-${process.pid}`);
  assert.equal(hasHistory(empty), false);
  const summary = summarizeHarnesses([
    { provider: "codex", snapshot: codex }, { provider: "cursor", snapshot: cursor },
    { provider: "claude", snapshot: empty }, { provider: "antigravity", error: "Unavailable" },
  ]);
  assert.equal(summary.connected.length, 2);
  assert.equal(summary.tokens, 100);
  assert.equal(summary.cost, 2);
  assert.equal(summary.sessions, 6);
  assert.equal(summary.reporting("tokens"), 1);
  assert.equal(summary.daily[0].cursor, 0);
  assert.equal(summarizeHarnesses([]).reporting("tokens"), 0);
});

test("Loading isolates failed harnesses and rejects mismatched provider responses", async () => {
  const codex = await fixture("codex");
  delete codex.provider;
  const calls: string[] = [];
  const result = await loadHarnesses(async (input) => {
    calls.push(String(input));
    const provider = new URL(String(input), "http://localhost").searchParams.get("provider");
    if (provider === "cursor") throw new Error("Connection failed");
    if (provider === "claude") return Response.json({ error: "No cloud snapshot yet" }, { status: 503 });
    return Response.json(codex);
  });
  assert.equal(calls.length, 4);
  assert.equal(result.locked, false);
  assert.equal(result.harnesses[0].snapshot?.totals.totalTokens, 100);
  assert.match(result.harnesses[1].error!, /No cloud snapshot/);
  assert.match(result.harnesses[2].error!, /Connection failed/);
  assert.match(result.harnesses[3].error!, /different harness/);
});

test("An authorization failure clears all private results", async () => {
  const snapshot = await fixture("codex");
  const result = await loadHarnesses(async (input) => String(input).includes("provider=claude")
    ? Response.json({ error: "Sign in" }, { status: 401 }) : Response.json(snapshot));
  assert.equal(result.locked, true);
  assert.deepEqual(result.harnesses, []);
});

test("combineSnapshots adds harnesses into one snapshot that the cards can draw", async () => {
  const harnesses = await Promise.all(PROVIDERS.map((provider, index) => fixture(provider, (index + 1) * 100)));
  const before = JSON.stringify(harnesses);
  const all = combineSnapshots(harnesses)!;
  assert.equal(all.totals.totalTokens, 1000);
  assert.equal(all.totals.sessions, 12);
  assert.equal(all.totals.costUsd, 8);
  assert.deepEqual(all.daily.map((d) => [d.date, d.totalTokens, d.sessions]), [["2026-10-19", 500, 0], ["2026-10-21", 500, 0]]);
  assert.equal(all.coverage.firstEvent, "2026-10-19T12:00:00Z");
  assert.equal(JSON.stringify(harnesses), before);
  assert.equal(combineSnapshots([]), null);
});

test("combineSnapshots skips empty harnesses and metrics a harness cannot report", async () => {
  const cursor = await fixture("cursor", 999);
  cursor.availability = { tokens: false, cost: false, sessions: true, humanRequests: true, assistantRequests: false, cacheBreakdown: false };
  const claude = await fixture("claude", 50);
  const empty = await collectUsage(`/tmp/vibe-check-overview-missing-${process.pid}`);
  const all = combineSnapshots([cursor, claude, { ...empty, provider: "codex" }])!;
  assert.equal(all.totals.totalTokens, 50);
  assert.equal(all.totals.costUsd, 2);
  assert.equal(all.totals.sessions, 6);
  assert.equal(all.availability?.tokens, true);
  const none = combineSnapshots([cursor])!;
  assert.equal(none.availability?.tokens, false);
  assert.equal(none.availability?.cost, false);
});

test("mergeHarnesses sums models by name, keeps same-timezone hours and names the power harness", async () => {
  const model = (name: string, tokens: number, cost: number, priced = true) => ({
    model: name, inputTokens: tokens, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
    reasoningTokens: 0, totalTokens: tokens, costUsd: cost, requests: 1, priced, unpricedTokens: 0,
  });
  const codex = await fixture("codex", 100);
  codex.models = [model("gpt-5", 60, 1), model("shared", 40, 1)];
  codex.hours = [{ hour: 9, tokens: 100, requests: 2 }];
  codex.mostExpensive24h = { start: "2026-10-19T00:00:00Z", end: "2026-10-20T00:00:00Z", costUsd: 1, tokens: 50 };
  codex.coverage.warnings = ["Old files skipped."];
  const claude = await fixture("claude", 200);
  claude.models = [model("shared", 200, 3, false)];
  claude.hours = [{ hour: 9, tokens: 200, requests: 1 }];
  claude.mostExpensive24h = { start: "2026-10-21T00:00:00Z", end: "2026-10-22T00:00:00Z", costUsd: 3, tokens: 150 };
  const elsewhere = await fixture("cursor", 50);
  elsewhere.timezone = elsewhere.timezone === "Asia/Tokyo" ? "Europe/Paris" : "Asia/Tokyo";
  elsewhere.hours = [{ hour: 9, tokens: 50, requests: 1 }];
  const harnesses = [{ provider: "codex" as const, snapshot: codex }, { provider: "claude" as const, snapshot: claude },
    { provider: "cursor" as const, snapshot: elsewhere }, { provider: "antigravity" as const, error: "Could not connect." }];
  const all = mergeHarnesses(harnesses);
  assert.deepEqual(all.models.map((m) => [m.model, m.totalTokens, m.costUsd, m.priced]), [["shared", 240, 4, false], ["gpt-5", 60, 1, true]]);
  assert.equal(all.hours[9].tokens, 300);
  assert.equal(all.mostExpensive24h?.costUsd, 3);
  assert.equal(biggestWindow(harnesses)?.provider, "claude");
  assert.equal(all.coverage.warnings[0], "Codex: Old files skipped.");
  assert.ok(all.coverage.warnings.every((w) => /^(Codex|Claude Code|Cursor): /.test(w)));
  assert.equal(all.totals.totalTokens, 350);
});

test("mergeHarnesses still draws an empty page when no harness has history", () => {
  const all = mergeHarnesses([{ provider: "codex", error: "Could not connect." }]);
  assert.equal(all.totals.totalTokens, 0);
  assert.deepEqual(all.models, []);
  assert.equal(all.mostExpensive24h, null);
});
