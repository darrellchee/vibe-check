import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectUsage } from "../lib/collector";
import { estimateCost, RATES } from "../lib/pricing";
import type { TokenTotals } from "../lib/types";

const tokens = (
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
): TokenTotals => ({
  inputTokens,
  cachedInputTokens,
  cacheWriteTokens,
  outputTokens,
  reasoningTokens: 0,
  totalTokens: inputTokens + outputTokens,
});
const close = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-10,
    `${actual} should equal ${expected}`,
  );
const meta = (id: string) => ({
  type: "session_meta",
  timestamp: "2026-10-01T00:00:00Z",
  payload: { id },
});
const usage = (
  session: string,
  id: string,
  timestamp: string,
  model: string,
  input: number,
  cached: number,
  output: number,
) => ({
  type: "token_usage_record",
  timestamp,
  payload: {
    thread_id: session,
    response_id: id,
    model,
    usage: {
      input_tokens: input,
      cached_input_tokens: cached,
      output_tokens: output,
    },
  },
});
async function fixture(
  files: Record<string, unknown[]>,
  run: (home: string) => Promise<void>,
) {
  const home = await mkdtemp(path.join(tmpdir(), "atlas-qa-"));
  await mkdir(path.join(home, "sessions"));
  try {
    for (const [name, lines] of Object.entries(files))
      await writeFile(
        path.join(home, "sessions", name),
        lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
      );
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("pricing separately charges uncached input, cache reads, cache writes and output", () => {
  const rate = RATES["gpt-6.1-sol"];
  const t = tokens(200_000, 80_000, 20_000, 30_000);
  close(
    estimateCost("gpt-6.1-sol", t)!,
    (90_000 * rate.input +
      80_000 * rate.cached +
      30_000 * rate.write +
      20_000 * rate.output) /
      1_000_000,
  );
  assert.equal(estimateCost("an-unknown-model", t), null);
});

test("pricing applies long context at request level and known service multipliers", () => {
  const rate = RATES["gpt-6.1-sol"];
  const t = tokens(300_000, 100_000, 50_000);
  const standard =
    ((200_000 * rate.input + 100_000 * rate.cached) * 2 +
      50_000 * rate.output * 1.5) /
    1_000_000;
  close(estimateCost("gpt-6.1-sol", t)!, standard);
  close(estimateCost("gpt-6.1-sol", t, "fast")!, standard * 2);
  close(estimateCost("gpt-6.1-sol", t, "batch")!, standard / 2);
  const boundary = tokens(272_000, 0, 1);
  close(
    estimateCost("gpt-6.1-sol", boundary)!,
    (272_000 * rate.input + rate.output) / 1_000_000,
  );
});

test("snapshot totals, daily buckets, model shares, hours and averages reconcile", async () => {
  await fixture(
    {
      "one.jsonl": [
        meta("one"),
        {
          type: "event_msg",
          timestamp: "2026-10-01T12:00:00Z",
          payload: { type: "user_message", message: "fixture message" },
        },
        usage(
          "one",
          "response-1",
          "2026-10-01T12:01:00Z",
          "gpt-6.1-sol",
          1000,
          200,
          500,
        ),
        usage(
          "one",
          "response-2",
          "2026-10-02T12:01:00Z",
          "an-unknown-model",
          400,
          100,
          100,
        ),
      ],
      "two.jsonl": [
        meta("two"),
        usage(
          "two",
          "response-3",
          "2026-10-02T12:30:00Z",
          "gpt-6.1-sol",
          100,
          0,
          50,
        ),
      ],
    },
    async (home) => {
      const result = await collectUsage(home);
      assert.equal(result.totals.totalTokens, 2150);
      assert.equal(result.totals.inputTokens, 1500);
      assert.equal(result.totals.outputTokens, 650);
      assert.equal(result.totals.cachedInputTokens, 300);
      assert.equal(result.totals.sessions, 2);
      assert.equal(result.totals.humanRequests, 1);
      assert.equal(result.totals.assistantRequests, 3);
      assert.equal(result.totals.averageTokensPerSession, 1075);
      assert.equal(result.totals.unpricedTokens, 500);
      assert.equal(
        result.models.find((m) => m.model === "an-unknown-model")?.priced,
        false,
      );
      assert.equal(
        result.daily.reduce((sum, d) => sum + d.totalTokens, 0),
        2150,
      );
      assert.equal(
        result.hours.reduce((sum, h) => sum + h.tokens, 0),
        2150,
      );
      assert.equal(
        result.models.reduce((sum, m) => sum + m.totalTokens, 0),
        2150,
      );
      close(
        result.daily.reduce((sum, d) => sum + d.costUsd, 0),
        result.totals.costUsd,
      );
      assert.equal(result.coverage.firstEvent, "2026-10-01T12:01:00.000Z");
      assert.equal(result.coverage.lastEvent, "2026-10-02T12:30:00.000Z");
      const encoded = JSON.stringify(result);
      for (const privateValue of [
        "fixture message",
        "response-1",
        "response-2",
        "response-3",
        "thread_id",
        "response_id",
      ])
        assert.equal(encoded.includes(privateValue), false);
    },
  );
});

test("empty available history has no invented activity or cost", async () => {
  await fixture({}, async (home) => {
    const result = await collectUsage(home);
    assert.equal(result.totals.totalTokens, 0);
    assert.equal(result.totals.sessions, 0);
    assert.equal(result.totals.averageTokensPerSession, 0);
    assert.equal(result.mostExpensiveDay, null);
    assert.equal(result.coverage.firstEvent, null);
    assert.deepEqual(result.models, []);
    assert.deepEqual(result.daily, []);
  });
});

test("request-only conversations count toward daily and total sessions consistently", async () => {
  await fixture(
    {
      "request-only.jsonl": [
        meta("request-only"),
        {
          type: "response_item",
          timestamp: "2026-10-04T12:00:00Z",
          payload: {
            type: "message",
            role: "user",
            content: "request without recorded response",
          },
        },
      ],
    },
    async (home) => {
      const result = await collectUsage(home);
      assert.equal(result.totals.sessions, 1);
      assert.equal(result.totals.humanRequests, 1);
      assert.equal(result.totals.totalTokens, 0);
      assert.equal(result.totals.averageTokensPerSession, 0);
      assert.equal(result.daily.length, 1);
      assert.equal(result.daily[0].sessions, 1);
      assert.equal(result.daily[0].humanRequests, 1);
    },
  );
});
