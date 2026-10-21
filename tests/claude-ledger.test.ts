import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, stat, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectClaudeUsage } from "../lib/claude-collector";
import { resetLedgerCache } from "../lib/claude-ledger";
import { validateSnapshot } from "../lib/validation";

const usage = (output: number) => ({
  input_tokens: 20,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 40,
  cache_creation: { ephemeral_1h_input_tokens: 30, ephemeral_5m_input_tokens: 10 },
  output_tokens: output,
});
const assistant = (id: string, output = 10, stamp = "2026-10-18T12:00:00Z", extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  uuid: `u-${id}-${output}`,
  sessionId: "secret-session-name",
  timestamp: stamp,
  requestId: `req-${id}`,
  message: {
    id,
    model: "claude-opus-5",
    usage: { ...usage(output), ...extra },
    content: [{ type: "text", text: "private response text" }],
  },
});
const user = (id: string, stamp = "2026-10-18T11:59:00Z") => ({
  type: "user",
  uuid: id,
  promptId: id,
  sessionId: "secret-session-name",
  timestamp: stamp,
  message: { role: "user", content: "private prompt text" },
});
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

async function fixture(
  run: (ctx: { home: string; ledger: string; transcript: string; write: (rows: unknown[]) => Promise<void> }) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-ledger-test-"));
  const names = ["CLAUDE_LEDGER_PATH", "CLAUDE_LEDGER"];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  const home = path.join(dir, "home");
  const transcript = path.join(home, "projects", "p", "session.jsonl");
  const ledger = path.join(dir, "data", "ledger.jsonl");
  await mkdir(path.dirname(transcript), { recursive: true });
  process.env.CLAUDE_LEDGER_PATH = ledger;
  delete process.env.CLAUDE_LEDGER;
  resetLedgerCache();
  try {
    await run({ home, ledger, transcript, write: (rows) => writeFile(transcript, jsonl(rows)) });
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetLedgerCache();
    await rm(dir, { recursive: true, force: true });
  }
}

test("Claude history survives Claude Code deleting old transcripts", async () =>
  fixture(async ({ home, ledger, transcript, write }) => {
    await write([user("h1"), assistant("m1"), assistant("m2", 25)]);
    const before = await collectClaudeUsage(home, null);
    assert.equal(before.totals.assistantRequests, 2);
    assert.equal(before.totals.humanRequests, 1);
    assert.ok(before.totals.costUsd > 0);

    // Claude Code's cleanup sweep removes the transcript.
    await rm(transcript);
    const after = await collectClaudeUsage(home, null);
    assert.doesNotThrow(() => validateSnapshot(after));
    assert.equal(after.totals.assistantRequests, 2);
    assert.equal(after.totals.humanRequests, 1);
    assert.equal(after.totals.totalTokens, before.totals.totalTokens);
    assert.equal(after.totals.sessions, before.totals.sessions);
    assert.equal(after.totals.costUsd, before.totals.costUsd);
    assert.deepEqual(after.daily.map((d) => d.date), before.daily.map((d) => d.date));
    assert.ok(after.coverage.warnings.some((w) => /come from the ledger/.test(w)));

    // A fresh process (new in-memory cache) reads the same history back from disk.
    resetLedgerCache();
    assert.equal((await collectClaudeUsage(home, null)).totals.totalTokens, before.totals.totalTokens);
    assert.ok((await stat(ledger)).size > 0);
  }));

test("Claude ledger holds only hashed IDs and token counts, never content, and is owner-only", async () =>
  fixture(async ({ home, ledger, write }) => {
    await write([user("prompt-uuid-123"), assistant("msg_secret_id", 30)]);
    await collectClaudeUsage(home, null);
    const text = await readFile(ledger, "utf8");
    for (const secret of ["private prompt text", "private response text", "secret-session-name", "msg_secret_id", "prompt-uuid-123", "req-msg_secret_id", home])
      assert.ok(!text.includes(secret), secret);
    assert.match(text, /claude-opus-5/);
    assert.equal(((await stat(ledger)).mode & 0o777).toString(8), "600");
  }));

test("Claude ledger takes the largest streamed usage for a message instead of summing fragments", async () =>
  fixture(async ({ home, transcript, write }) => {
    await write([assistant("m1", 5)]);
    const partial = await collectClaudeUsage(home, null);
    await write([assistant("m1", 50)]);
    const done = await collectClaudeUsage(home, null);
    assert.equal(done.totals.assistantRequests, 1);
    assert.equal(done.totals.outputTokens, 50);
    assert.equal(partial.totals.outputTokens, 5);
    await rm(transcript);
    resetLedgerCache();
    const kept = await collectClaudeUsage(home, null);
    assert.equal(kept.totals.assistantRequests, 1);
    assert.equal(kept.totals.outputTokens, 50);
  }));

test("Claude ledger only appends what is new", async () =>
  fixture(async ({ home, ledger, write }) => {
    await write([user("h1"), assistant("m1")]);
    await collectClaudeUsage(home, null);
    const size = (await stat(ledger)).size;
    await collectClaudeUsage(home, null);
    resetLedgerCache();
    await collectClaudeUsage(home, null);
    assert.equal((await stat(ledger)).size, size);
    await write([user("h1"), assistant("m1"), assistant("m2")]);
    await collectClaudeUsage(home, null);
    assert.ok((await stat(ledger)).size > size);
  }));

test("Claude ledger ignores corrupt, forged and half-written lines", async () =>
  fixture(async ({ home, ledger, transcript, write }) => {
    await write([assistant("m1")]);
    await collectClaudeUsage(home, null);
    await appendFile(
      ledger,
      [
        "not json",
        JSON.stringify(["e", "raw-id-not-a-hash", "2026-10-18T12:00:00.000Z", "a".repeat(32), "claude-opus-5", [1, 1, 1, 1, 1], 0, null, null, null]),
        JSON.stringify(["e", "b".repeat(32), "2026-10-18T12:00:00.000Z", "a".repeat(32), "bad model!", [1, 1, 1, 1, 1], 0, null, null, null]),
        JSON.stringify(["e", "c".repeat(32), "2026-10-18T12:00:00.000Z", "a".repeat(32), "claude-opus-5", [-1, 1, 1, 1, 1], 0, null, null, null]),
        '["e","' + "d".repeat(32) + '","2026-10-18T12:00', // torn write, no newline
      ].join("\n"),
    );
    await rm(transcript);
    resetLedgerCache();
    const s = await collectClaudeUsage(home, null);
    assert.equal(s.totals.assistantRequests, 1);
    assert.equal(s.totals.humanRequests, 0);
  }));

test("Claude collection still works when the ledger cannot be used, and says so", async () =>
  fixture(async ({ home, write }) => {
    await write([assistant("m1")]);
    // A directory where the file should be makes every read and write fail.
    await mkdir(process.env.CLAUDE_LEDGER_PATH!, { recursive: true });
    const s = await collectClaudeUsage(home, null);
    assert.equal(s.totals.assistantRequests, 1);
    assert.ok(s.coverage.warnings.some((w) => /could not be read or written/.test(w)));
  }));

test("Claude ledger can be switched off, and an explicit home never creates one on its own", async () => {
  await fixture(async ({ home, ledger, write }) => {
    await write([assistant("m1")]);
    process.env.CLAUDE_LEDGER = "false";
    const s = await collectClaudeUsage(home, null);
    assert.equal(s.totals.assistantRequests, 1);
    await assert.rejects(stat(ledger));
    assert.ok(!s.coverage.warnings.some((w) => /come from the ledger/.test(w)));
  });
  await fixture(async ({ home, write }) => {
    await write([assistant("m1")]);
    delete process.env.CLAUDE_LEDGER_PATH;
    const dataDir = path.join(process.cwd(), "data");
    const list = () => readdir(dataDir).then((n) => n.filter((f) => f.startsWith("claude-ledger-")).sort(), () => [] as string[]);
    const before = await list();
    await collectClaudeUsage(home, null);
    assert.deepEqual(await list(), before);
  });
});

test("Claude ledger round-trips records with empty-string metadata and does not rewrite them", async () =>
  fixture(async ({ home, ledger, transcript, write }) => {
    // Real transcripts contain inference_geo: "" and other empty/unknown values.
    await write([assistant("m1", 10, "2026-10-18T12:00:00Z", { inference_geo: "", service_tier: "standard", speed: "standard" })]);
    await collectClaudeUsage(home, null);
    const size = (await stat(ledger)).size;
    resetLedgerCache();
    await collectClaudeUsage(home, null);
    // Rejected-on-load records would be re-appended on every run.
    assert.equal((await stat(ledger)).size, size);
    await rm(transcript);
    resetLedgerCache();
    assert.equal((await collectClaudeUsage(home, null)).totals.assistantRequests, 1);
  }));
