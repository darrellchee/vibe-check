import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { collectUsage } from "../lib/collector";
import { estimateCost } from "../lib/pricing";

const stamp = "2026-10-19T02:00:00.000Z";
const row = (
  type: string,
  payload: object,
  timestamp = stamp,
  ordinal = 100,
) => ({ type, payload, timestamp, ordinal });
const usage = (input = 100, output = 20) => ({
  input_tokens: input,
  cached_input_tokens: 40,
  output_tokens: output,
});
const meta = (id = "root") => row("session_meta", { id });
const context = (model = "gpt-6.1-sol") => row("turn_context", { model });
const record = (id: string, timestamp = stamp, values = usage()) =>
  row("token_usage_record", { response_id: id, usage: values }, timestamp);
async function fixture(
  run: (
    home: string,
    put: (name: string, rows: unknown[]) => Promise<void>,
  ) => Promise<void>,
) {
  const home = await mkdtemp(path.join(tmpdir(), "usage-test-"));
  try {
    await mkdir(path.join(home, "sessions"));
    await mkdir(path.join(home, "archived_sessions"));
    await run(home, async (name, rows) => {
      await writeFile(
        path.join(home, name),
        rows
          .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
          .join("\n"),
      );
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("modern usage wins over cumulative counters and duplicates across archives", async () =>
  fixture(async (home, put) => {
    const rows = [
      meta(),
      context(),
      record("one"),
      row("event_msg", {
        type: "token_count",
        info: { total_token_usage: usage() },
      }),
    ];
    await put("sessions/a.jsonl", rows);
    await put("archived_sessions/copy.jsonl", rows);
    const data = await collectUsage(home);
    assert.equal(data.totals.totalTokens, 120);
    assert.equal(data.totals.assistantRequests, 1);
    assert.equal(data.totals.sessions, 1);
    assert.equal(data.models[0].model, "gpt-6.1-sol");
  }));
test("legacy cumulative counters deduplicate unchanged values and handle resets", async () =>
  fixture(async (home, put) => {
    const counter = (v: object, timestamp: string) =>
      row(
        "event_msg",
        { type: "token_count", info: { total_token_usage: v } },
        timestamp,
      );
    await put("sessions/a.jsonl", [
      meta(),
      context(),
      counter(usage(), stamp),
      counter(usage(), stamp),
      counter(usage(200, 40), "2026-10-19T02:01:00Z"),
      counter(usage(50, 10), "2026-10-19T02:02:00Z"),
    ]);
    const data = await collectUsage(home);
    assert.equal(data.totals.totalTokens, 300);
    assert.equal(data.totals.assistantRequests, 3);
  }));
test("unknown model stays unpriced, invalid final line is tolerated and sensitive data never leaves collector", async () =>
  fixture(async (home, put) => {
    await put("sessions/a.jsonl", [
      meta("private-id"),
      context("future-model"),
      record("response-private"),
      row("response_item", {
        type: "message",
        role: "user",
        content: "private-message",
      }),
      "{",
    ]);
    const data = await collectUsage(home);
    assert.equal(data.totals.unpricedTokens, 120);
    assert.equal(data.totals.costUsd, 0);
    assert.equal(data.coverage.malformedLines, 1);
    assert.equal(data.totals.humanRequests, 1);
    assert.ok(!JSON.stringify(data).includes("private"));
  }));
test("child inherited records are excluded and real child usage retained", async () =>
  fixture(async (home, put) => {
    await put("sessions/a.jsonl", [meta(), context(), record("parent")]);
    await put("sessions/b.jsonl", [
      row("session_meta", {
        id: "child",
        parent_thread_id: "root",
        subagent_history_start_ordinal: 20,
      }),
      context(),
      { ...record("parent"), ordinal: 10 },
      record("child"),
      row("response_item", {
        type: "message",
        role: "user",
        content: "agent-task",
      }),
    ]);
    const data = await collectUsage(home);
    assert.equal(data.totals.totalTokens, 240);
    assert.equal(data.totals.sessions, 2);
    assert.equal(data.totals.humanRequests, 0);
  }));
test("rolling 24 hours crosses calendar dates and excludes exact old boundary", async () =>
  fixture(async (home, put) => {
    await put("sessions/a.jsonl", [
      meta(),
      context(),
      record("one", "2026-10-17T23:00:00Z"),
      record("two", "2026-10-18T22:00:00Z"),
      record("three", "2026-10-18T23:00:00Z"),
    ]);
    const data = await collectUsage(home);
    assert.equal(data.mostExpensive24h?.tokens, 240);
    assert.equal(data.mostExpensive24h?.end, "2026-10-18T22:00:00.000Z");
  }));
test("pricing separates cached input without billing reasoning twice", () => {
  const tokens = {
    inputTokens: 1_000_000,
    cachedInputTokens: 400_000,
    cacheWriteTokens: 0,
    outputTokens: 100_000,
    reasoningTokens: 50_000,
    totalTokens: 1_100_000,
  };
  assert.equal(estimateCost("gpt-6.1-sol", tokens), 3.98);
  assert.equal(estimateCost("gpt-6.1-sol", tokens, "ultrafast"), 23.88);
  assert.equal(estimateCost("unknown", tokens), null);
});

test("compressed retained history matches plain usage and deduplicates archive copies", async () =>
  fixture(async (home, put) => {
    const rows = [meta(), context(), record("compressed-response")];
    await writeFile(
      path.join(home, "sessions", "old.jsonl.zst"),
      zstdCompressSync(rows.map((r) => JSON.stringify(r)).join("\n")),
    );
    await put("archived_sessions/copy.jsonl", rows);
    const data = await collectUsage(home);
    assert.equal(data.coverage.filesScanned, 2);
    assert.equal(data.totals.totalTokens, 120);
    assert.equal(data.totals.assistantRequests, 1);
  }));

test("cached history invalidates when files grow, replace, or disappear", async () =>
  fixture(async (home, put) => {
    await put("sessions/a.jsonl", [meta(), context(), record("one")]);
    const first = await collectUsage(home);
    assert.equal(first.totals.totalTokens, 120);
    assert.equal((await collectUsage(home)).totals.totalTokens, 120);
    await put("sessions/a.jsonl", [
      meta(),
      context(),
      record("one"),
      record("two"),
    ]);
    assert.equal((await collectUsage(home)).totals.totalTokens, 240);
    await put("sessions/a.jsonl", [
      meta(),
      context(),
      record("replacement", stamp, usage(200, 40)),
    ]);
    assert.equal((await collectUsage(home)).totals.totalTokens, 240);
    await rm(path.join(home, "sessions/a.jsonl"));
    assert.equal((await collectUsage(home)).totals.totalTokens, 0);
  }));

test("corrupt compressed history fails visibly rather than silently dropping retained usage", async () =>
  fixture(async (home) => {
    await writeFile(
      path.join(home, "sessions/corrupt.jsonl.zst"),
      "not compressed data",
    );
    await assert.rejects(collectUsage(home));
  }));

test("forked compressed history preserves the first physical thread metadata", async () =>
  fixture(async (home, put) => {
    await put("sessions/root.jsonl", [
      meta(),
      context(),
      record("parent-response"),
    ]);
    const rows = [
      row(
        "session_meta",
        {
          id: "child",
          parent_thread_id: "root",
          subagent_history_start_ordinal: 20,
        },
        stamp,
        0,
      ),
      row("session_meta", { id: "root" }, stamp, 1),
      { ...context(), ordinal: 2 },
      { ...record("parent-response"), ordinal: 3 },
      row(
        "response_item",
        { type: "message", role: "user", content: "parent-message" },
        stamp,
        4,
      ),
      record("child-response"),
      row("response_item", {
        type: "message",
        role: "user",
        content: "agent-prompt",
      }),
    ];
    await writeFile(
      path.join(home, "sessions/child.jsonl.zst"),
      zstdCompressSync(rows.map((r) => JSON.stringify(r)).join("\n")),
    );
    const data = await collectUsage(home);
    assert.equal(data.totals.totalTokens, 240);
    assert.equal(data.totals.sessions, 2);
    assert.equal(data.totals.humanRequests, 0);
  }));

test("legacy child preserves its own identity and subtracts inherited cumulative baseline", async () =>
  fixture(async (home, put) => {
    const counter = (input: number, output: number, ordinal: number) =>
      row(
        "event_msg",
        {
          type: "token_count",
          info: { total_token_usage: usage(input, output) },
        },
        stamp,
        ordinal,
      );
    await put("sessions/root.jsonl", [meta(), context(), counter(100, 20, 10)]);
    const rows = [
      row(
        "session_meta",
        {
          id: "child",
          parent_thread_id: "root",
          subagent_history_start_ordinal: 20,
        },
        stamp,
        0,
      ),
      row("session_meta", { id: "root" }, stamp, 1),
      { ...context(), ordinal: 2 },
      counter(100, 20, 3),
      row(
        "response_item",
        { type: "message", role: "user", content: "inherited-human" },
        stamp,
        4,
      ),
      counter(200, 40, 21),
      row("response_item", {
        type: "message",
        role: "user",
        content: "agent-prompt",
      }),
    ];
    await writeFile(
      path.join(home, "sessions/child.jsonl.zst"),
      zstdCompressSync(rows.map((r) => JSON.stringify(r)).join("\n")),
    );
    const data = await collectUsage(home);
    assert.equal(data.totals.totalTokens, 240);
    assert.equal(data.totals.assistantRequests, 2);
    assert.equal(data.totals.sessions, 2);
    assert.equal(data.totals.humanRequests, 0);
  }));
