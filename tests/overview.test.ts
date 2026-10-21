import test from "node:test";
import assert from "node:assert/strict";
import { collectUsage } from "../lib/collector";
import { hasHistory, loadHarnesses, summarizeHarnesses } from "../lib/overview";
import { PROVIDERS } from "../lib/providers";
import type { UsageProvider, UsageSnapshot } from "../lib/types";

async function fixture(provider: UsageProvider, tokens = 100): Promise<UsageSnapshot> {
  const empty = await collectUsage(`/tmp/atlas-overview-missing-${process.pid}`);
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
  const empty = await collectUsage(`/tmp/atlas-overview-empty-${process.pid}`);
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
