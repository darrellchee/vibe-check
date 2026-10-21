import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { collectClaudeUsage } from "../lib/claude-collector";
import { estimateClaudeCost } from "../lib/claude-pricing";

const stamp = "2026-10-18T12:00:00Z";
const usage = (output = 10) => ({
  input_tokens: 20,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 40,
  cache_creation: {
    ephemeral_1h_input_tokens: 30,
    ephemeral_5m_input_tokens: 10,
  },
  output_tokens: output,
  output_tokens_details: { thinking_tokens: 4 },
});
const assistant = (
  id = "response",
  output = 10,
  extra: Record<string, unknown> = {},
) => ({
  type: "assistant",
  uuid: `fragment-${output}`,
  sessionId: "session",
  timestamp: stamp,
  requestId: `req-${id}`,
  message: {
    id,
    model: "claude-opus-5",
    usage: usage(output),
    content: [{ type: "text", text: "private text" }],
  },
  ...extra,
});
const user = (id = "human", extra: Record<string, unknown> = {}) => ({
  type: "user",
  uuid: id,
  promptId: id,
  sessionId: "session",
  timestamp: stamp,
  message: { role: "user", content: "private prompt" },
  ...extra,
});
async function fixture(
  run: (
    home: string,
    put: (name: string, rows: unknown[]) => Promise<void>,
  ) => Promise<void>,
) {
  const home = await mkdtemp(path.join(tmpdir(), "claude-usage-test-"));
  try {
    await mkdir(path.join(home, "projects"));
    await run(home, async (name, rows) => {
      const file = path.join(home, "projects", name);
      await mkdir(path.dirname(file), { recursive: true });
      const content = rows
        .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
        .join("\n");
      await writeFile(
        file,
        name.endsWith(".zst")
          ? zstdCompressSync(content)
          : name.endsWith(".gz")
            ? gzipSync(content)
            : content,
      );
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("Claude input normalizes cache subsets and repeated fragments count once at maximum output", async () =>
  fixture(async (home, put) => {
    await put("project/a.jsonl", [
      assistant("same", 1),
      assistant("same", 10),
      assistant("same", 3),
      user(),
    ]);
    const s = await collectClaudeUsage(home);
    assert.equal(s.provider, "claude");
    assert.equal(s.totals.inputTokens, 160);
    assert.equal(s.totals.cachedInputTokens, 100);
    assert.equal(s.totals.cacheWriteTokens, 40);
    assert.equal(s.totals.outputTokens, 10);
    assert.equal(s.totals.reasoningTokens, 4);
    assert.equal(s.totals.totalTokens, 170);
    assert.equal(s.totals.assistantRequests, 1);
    assert.equal(s.totals.humanRequests, 1);
    assert.ok(Math.abs(s.totals.costUsd - 0.0007625) < 1e-12);
    const serialized = JSON.stringify(s);
    assert.ok(!serialized.includes("private"));
    assert.ok(!serialized.includes("req-same"));
  }));
test("Claude root human requests exclude metadata tool results and subagents; nested agents count as sessions", async () =>
  fixture(async (home, put) => {
    await put("p/root.jsonl", [
      assistant(),
      user(),
      user("tool", {
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "private output" }],
        },
      }),
      user("meta", { isMeta: true }),
      user("side", { isSidechain: true }),
    ]);
    await put("p/session/subagents/agent-one.jsonl", [
      assistant("child", 10, { agentId: "one", isSidechain: true }),
      user("agent-user", { isSidechain: true }),
    ]);
    const s = await collectClaudeUsage(home);
    assert.equal(s.totals.humanRequests, 1);
    assert.equal(s.totals.assistantRequests, 2);
    assert.equal(s.totals.sessions, 2);
    assert.equal(s.daily[0].sessions, 2);
  }));
test("Claude deduplicates copied compressed logs and tolerates malformed rows", async () =>
  fixture(async (home, put) => {
    const rows = [
      assistant(),
      user(),
      "null",
      "{",
      { type: "assistant", timestamp: stamp, message: null },
    ];
    await put("p/root.jsonl", rows);
    await put("p/copy.jsonl.zst", [assistant(), user()]);
    await put("p/copy.jsonl.gz", [assistant(), user()]);
    const s = await collectClaudeUsage(home);
    assert.equal(s.coverage.filesScanned, 3);
    assert.equal(s.coverage.malformedLines, 2);
    assert.equal(s.totals.totalTokens, 170);
    assert.equal(s.totals.humanRequests, 1);
  }));
test("Claude unknown models are unpriced and synthetic responses do not inflate activity", async () =>
  fixture(async (home, put) => {
    await put("p/a.jsonl", [
      assistant("unknown", 10, {
        message: { id: "future", model: "claude-future", usage: usage() },
      }),
      assistant("synthetic", 10, {
        message: { id: "synthetic", model: "<synthetic>", usage: usage() },
      }),
    ]);
    const s = await collectClaudeUsage(home);
    assert.equal(s.totals.assistantRequests, 1);
    assert.equal(s.totals.unpricedTokens, 170);
    assert.equal(s.totals.costUsd, 0);
  }));
test("Claude cached files invalidate when changed or removed", async () =>
  fixture(async (home, put) => {
    await put("p/a.jsonl", [assistant()]);
    assert.equal((await collectClaudeUsage(home)).totals.totalTokens, 170);
    assert.equal((await collectClaudeUsage(home)).totals.totalTokens, 170);
    await put("p/a.jsonl", [assistant(), assistant("another", 20)]);
    assert.equal((await collectClaudeUsage(home)).totals.totalTokens, 350);
    await rm(path.join(home, "projects/p/a.jsonl"));
    assert.equal((await collectClaudeUsage(home)).totals.totalTokens, 0);
  }));
test("Claude corrupted archives fail visibly", async () =>
  fixture(async (home) => {
    await writeFile(path.join(home, "projects/corrupt.jsonl.zst"), "corrupt");
    await assert.rejects(collectClaudeUsage(home));
  }));
test("Claude rolling most expensive 24h crosses dates and excludes old boundary", async () =>
  fixture(async (home, put) => {
    await put("p/a.jsonl", [
      assistant("a", 10, { timestamp: "2026-10-15T23:00:00Z" }),
      assistant("b", 10, { timestamp: "2026-10-16T22:00:00Z" }),
      assistant("c", 10, { timestamp: "2026-10-16T23:00:00Z" }),
    ]);
    const s = await collectClaudeUsage(home);
    assert.equal(s.mostExpensive24h?.tokens, 340);
    assert.equal(s.mostExpensive24h?.end, "2026-10-16T22:00:00.000Z");
  }));
test("Claude pricing uses current snapshot family, TTL, speed, geography, and Haiku length tiers", () => {
  const tokens = {
    inputTokens: 1_000_000,
    cachedInputTokens: 400_000,
    cacheWriteTokens: 200_000,
    outputTokens: 100_000,
    reasoningTokens: 10_000,
    totalTokens: 1_100_000,
  };
  assert.equal(
    estimateClaudeCost("claude-opus-5", tokens, { write1hTokens: 100_000 }),
    6.325,
  );
  assert.equal(
    estimateClaudeCost("claude-opus-5", tokens, {
      write1hTokens: 100_000,
      speed: "fast",
      inferenceGeo: "us",
    }),
    13.915000000000001,
  );
  assert.equal(estimateClaudeCost("claude-haiku-4-5-20251001", tokens), 1.19);
  assert.equal(estimateClaudeCost("claude-haiku-5-5", tokens), 0.595);
  assert.equal(estimateClaudeCost("unknown", tokens), null);
});

test("Claude preserves valid JSON records containing bare CR whitespace", async () =>
  fixture(async (home, put) => {
    const record = JSON.stringify(assistant("with-cr", 100)).replace(
      '"message":',
      '\r"message":',
    );
    assert.equal(JSON.parse(record).message.usage.output_tokens, 100);
    await put("p/a.jsonl", [record]);
    const snapshot = await collectClaudeUsage(home);
    assert.equal(snapshot.coverage.malformedLines, 0);
    assert.equal(snapshot.totals.assistantRequests, 1);
    assert.equal(snapshot.totals.outputTokens, 100);
    assert.equal(snapshot.totals.totalTokens, 260);
  }));

test("Claude keeps Unicode line separators inside JSON strings rather than splitting response records", async () =>
  fixture(async (home, put) => {
    const record = assistant("unicode-lines", 100);
    record.message.content = [
      { type: "text", text: "alpha\u2028beta\u2029gamma\u0085delta" },
    ];
    await put("p/a.jsonl", [record]);
    const snapshot = await collectClaudeUsage(home);
    assert.equal(snapshot.coverage.malformedLines, 0);
    assert.equal(snapshot.totals.assistantRequests, 1);
    assert.equal(snapshot.totals.outputTokens, 100);
    assert.equal(snapshot.totals.totalTokens, 260);
  }));

test("Claude retains known model and pricing metadata when later response fragments omit them", async () =>
  fixture(async (home, put) => {
    const first = assistant("metadata", 1),
      last = assistant("metadata", 10);
    await put("p/a.jsonl", [
      {
        ...first,
        message: {
          ...first.message,
          usage: { ...usage(1), speed: "fast", inference_geo: "us" },
        },
      },
      { ...last, message: { id: last.message.id, usage: usage(10) } },
    ]);
    const snapshot = await collectClaudeUsage(home);
    assert.equal(snapshot.models[0].model, "claude-opus-5");
    assert.equal(snapshot.totals.unpricedTokens, 0);
    assert.equal(snapshot.totals.assistantRequests, 1);
    assert.ok(Math.abs(snapshot.totals.costUsd - 0.0007625 * 2 * 1.1) < 1e-12);
  }));

async function desktopFixture(
  run: (home: string, desktop: string) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "claude-desktop-test-"));
  const home = path.join(root, "home"),
    desktop = path.join(root, "desktop");
  try {
    await mkdir(path.join(home, "projects", "p"), { recursive: true });
    const sessionProjects = path.join(
      desktop,
      "local-agent-mode-sessions",
      "org",
      "user",
      "local_abc",
      ".claude",
      "projects",
      "p",
    );
    await mkdir(sessionProjects, { recursive: true });
    const write = (file: string, rows: unknown[]) =>
      writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n"));
    await write(path.join(home, "projects", "p", "a.jsonl"), [
      assistant("cli-only", 10),
      assistant("shared", 10),
    ]);
    await write(path.join(sessionProjects, "b.jsonl"), [
      assistant("shared", 10),
      assistant("desktop-only", 10, {
        message: {
          id: "desktop-only",
          model: "claude-sonnet-4-6",
          usage: usage(10),
        },
      }),
    ]);
    await run(home, desktop);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("Claude desktop agent-session transcripts are counted once alongside the CLI history", async () =>
  desktopFixture(async (home, desktop) => {
    const s = await collectClaudeUsage(home, desktop);
    assert.equal(s.totals.assistantRequests, 3);
    assert.deepEqual(s.models.map((m) => m.model).sort(), [
      "claude-opus-5",
      "claude-sonnet-4-6",
    ]);
  }));
test("an explicit Claude home does not pull in desktop transcripts unless asked", async () =>
  desktopFixture(async (home) => {
    assert.equal((await collectClaudeUsage(home)).totals.assistantRequests, 2);
    assert.equal(
      (await collectClaudeUsage(home, null)).totals.assistantRequests,
      2,
    );
  }));
