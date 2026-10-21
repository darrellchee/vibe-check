import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedJson, validateSnapshot } from "../lib/validation";
import type { UsageSnapshot } from "../lib/types";

const tokenZero = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};
export function emptySnapshot(): UsageSnapshot {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "local",
    timezone: "Australia/Sydney",
    coverage: {
      firstEvent: null,
      lastEvent: null,
      filesScanned: 0,
      malformedLines: 0,
      warnings: [],
    },
    totals: {
      ...tokenZero,
      sessions: 0,
      humanRequests: 0,
      assistantRequests: 0,
      averageTokensPerSession: 0,
      costUsd: 0,
      unpricedTokens: 0,
    },
    models: [],
    daily: [],
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      tokens: 0,
      requests: 0,
    })),
    mostExpensiveDay: null,
    mostExpensive24h: null,
    pricing: {
      checkedAt: "2026-10-19",
      sources: ["https://developers.openai.com/api/docs/pricing"],
    },
  };
}

test("versioned empty aggregate snapshot is valid", () => {
  const snapshot = emptySnapshot();
  assert.equal(validateSnapshot(snapshot), snapshot);
});

test("snapshot rejects private extra fields at every supported nesting level", () => {
  for (const key of ["transcript", "sessionIds", "apiKey", "projectPath"]) {
    const top = { ...emptySnapshot(), [key]: "private" };
    assert.throws(() => validateSnapshot(top));
    const nested = emptySnapshot();
    Object.assign(nested.totals, { [key]: "private" });
    assert.throws(() => validateSnapshot(nested));
  }
});

test("snapshot rejects unsafe counts, invalid zones, future collection and foreign source links", () => {
  for (const count of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 0.5]) {
    const snapshot = emptySnapshot();
    snapshot.totals.inputTokens = count;
    snapshot.totals.totalTokens = count;
    assert.throws(() => validateSnapshot(snapshot));
  }
  const wrongZone = emptySnapshot();
  wrongZone.timezone = "Not/A_Real_Zone";
  assert.throws(() => validateSnapshot(wrongZone));
  const future = emptySnapshot();
  future.generatedAt = new Date(Date.now() + 600_000).toISOString();
  assert.throws(() => validateSnapshot(future));
  const foreign = emptySnapshot();
  foreign.pricing.sources = [
    "https://developers.openai.com.attacker.example/api/docs/pricing",
  ];
  assert.throws(() => validateSnapshot(foreign));
  const impossible = emptySnapshot();
  impossible.pricing.checkedAt = "2026-02-31";
  assert.throws(() => validateSnapshot(impossible));
});

test("snapshot rejects totals that do not reconcile with published chart aggregates", () => {
  const mismatch = emptySnapshot();
  mismatch.totals.inputTokens = 10;
  mismatch.totals.totalTokens = 10;
  assert.throws(() => validateSnapshot(mismatch));
  const wrongAverage = emptySnapshot();
  wrongAverage.totals.averageTokensPerSession = 100;
  assert.throws(() => validateSnapshot(wrongAverage));
  const excessUnpriced = emptySnapshot();
  excessUnpriced.totals.unpricedTokens = 10;
  assert.throws(() => validateSnapshot(excessUnpriced));
});

test("bounded JSON reader counts actual streamed bytes rather than trusting content length", async () => {
  assert.deepEqual(
    await readBoundedJson(
      new Request("https://example.test", {
        method: "POST",
        body: '{"ok":true}',
      }),
      100,
    ),
    { ok: true },
  );
  const oversized = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Length": "1" },
    body: JSON.stringify({ text: "x".repeat(200) }),
  });
  await assert.rejects(
    () => readBoundedJson(oversized, 100),
    /Payload too large/,
  );
  const unicode = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ text: "é".repeat(60) }),
  });
  await assert.rejects(
    () => readBoundedJson(unicode, 100),
    /Payload too large/,
  );
  await assert.rejects(() =>
    readBoundedJson(
      new Request("https://example.test", { method: "POST", body: "{" }),
      100,
    ),
  );
});

test("collector-produced nonempty history is a valid upload with normalized source timestamps", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { collectUsage } = await import("../lib/collector");
  const home = await mkdtemp(path.join(tmpdir(), "atlas-payload-qa-"));
  try {
    await mkdir(path.join(home, "sessions"));
    const rows = [
      { type: "session_meta", payload: { id: "fixture-session" } },
      {
        type: "token_usage_record",
        timestamp: "2026-10-01T12:00:00+10:00",
        payload: {
          response_id: "fixture-response",
          model: "future-unpriced-model",
          usage: {
            input_tokens: 100,
            cached_input_tokens: 50,
            output_tokens: 20,
          },
        },
      },
      {
        type: "token_usage_record",
        timestamp: "2026-10-01T03:00:00Z",
        payload: {
          response_id: "fixture-response-2",
          model: "gpt-6.1-sol",
          usage: {
            input_tokens: 200,
            cached_input_tokens: 50,
            output_tokens: 30,
          },
        },
      },
    ];
    await writeFile(
      path.join(home, "sessions", "fixture.jsonl"),
      rows.map((row) => JSON.stringify(row)).join("\n"),
    );
    const result = await collectUsage(home);
    assert.equal(result.coverage.firstEvent, "2026-10-01T02:00:00.000Z");
    assert.equal(result.coverage.lastEvent, "2026-10-01T03:00:00.000Z");
    assert.equal(validateSnapshot(result), result);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
