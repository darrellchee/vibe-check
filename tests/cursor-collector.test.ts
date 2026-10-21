import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectCursorUsage } from "../lib/cursor-collector";
import { estimateCursorCost } from "../lib/cursor-pricing";
import { validateSnapshot } from "../lib/validation";

const header =
  "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";
const row =
  "2026-10-19T12:00:00Z,Included,claude-4-sonnet,No,3,4,5,6,18,Included";
async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "cursor-usage-test-"));
  const previous = {
    dir: process.env.CURSOR_USAGE_DIR,
    csv: process.env.CURSOR_USAGE_CSV,
    db: process.env.CURSOR_DB_PATH,
  };
  process.env.CURSOR_USAGE_DIR = dir;
  delete process.env.CURSOR_USAGE_CSV;
  process.env.CURSOR_DB_PATH = path.join(dir, "absent.sqlite");
  try {
    await run(dir);
  } finally {
    for (const [key, value] of Object.entries({
      CURSOR_USAGE_DIR: previous.dir,
      CURSOR_USAGE_CSV: previous.csv,
      CURSOR_DB_PATH: previous.db,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
test("Cursor CSV normalizes disjoint token columns and marks unavailable human/session metrics", async () =>
  fixture(async (dir) => {
    await writeFile(path.join(dir, "usage.csv"), header + "\n" + row);
    const s = await collectCursorUsage();
    assert.doesNotThrow(() => validateSnapshot(s));
    assert.equal(s.provider, "cursor");
    assert.equal(s.totals.inputTokens, 12);
    assert.equal(s.totals.cachedInputTokens, 5);
    assert.equal(s.totals.cacheWriteTokens, 3);
    assert.equal(s.totals.outputTokens, 6);
    assert.equal(s.totals.totalTokens, 18);
    assert.equal(s.totals.assistantRequests, 1);
    assert.deepEqual(s.availability, {
      tokens: true,
      cost: true,
      sessions: false,
      humanRequests: false,
      assistantRequests: true,
      cacheBreakdown: true,
    });
    assert.ok(Math.abs(s.totals.costUsd - 0.00011475) < 1e-12);
  }));
test("Cursor repeated equal rows remain distinct while overlapping exports deduplicate by multiplicity", async () =>
  fixture(async (dir) => {
    await writeFile(path.join(dir, "a.csv"), header + "\n" + row + "\n" + row);
    await writeFile(path.join(dir, "b.csv"), header + "\n" + row);
    const s = await collectCursorUsage();
    assert.equal(s.totals.assistantRequests, 2);
    assert.equal(s.totals.totalTokens, 36);
  }));
test("Cursor rejects malformed token rows and never prices Auto as a known model", async () =>
  fixture(async (dir) => {
    await writeFile(
      path.join(dir, "a.csv"),
      header +
        "\n" +
        row.replace("claude-4-sonnet", "auto") +
        "\n" +
        row.replace(",18,", ",999,"),
    );
    const s = await collectCursorUsage();
    assert.equal(s.totals.totalTokens, 18);
    assert.equal(s.totals.unpricedTokens, 18);
    assert.equal(s.totals.costUsd, 0);
    assert.equal(s.availability?.cost, false);
    assert.equal(s.coverage.malformedLines, 1);
  }));
test("Cursor accepts quoted cells and explicit event/conversation identifiers without exposing them", async () =>
  fixture(async (dir) => {
    const h = header + ",Request ID,Conversation ID";
    await writeFile(
      path.join(dir, "a.csv"),
      h +
        "\n" +
        row.replace("Included,claude", '"Included, ordinary",claude') +
        ",private-request,private-session\n" +
        row +
        ",private-request,private-session",
    );
    const s = await collectCursorUsage();
    assert.equal(s.totals.assistantRequests, 1);
    assert.equal(s.totals.sessions, 1);
    assert.equal(s.availability?.sessions, true);
    assert.ok(!JSON.stringify(s).includes("private-"));
  }));
test("Cursor malformed headers and unfinished quoted exports fail visibly", async () =>
  fixture(async (dir) => {
    const file = path.join(dir, "a.csv");
    await writeFile(file, "Date,Model\n2026-10-19,auto");
    await assert.rejects(collectCursorUsage(), /missing/);
    await writeFile(file, header + '\n"unfinished');
    await assert.rejects(collectCursorUsage(), /unfinished/);
  }));
test("Cursor missing sources report unavailable metrics rather than invented empty lifetime", async () =>
  fixture(async () => {
    const s = await collectCursorUsage();
    assert.deepEqual(s.availability, {
      tokens: false,
      cost: false,
      sessions: false,
      humanRequests: false,
      assistantRequests: false,
      cacheBreakdown: false,
    });
    assert.equal(s.coverage.firstEvent, null);
  }));
test("Cursor local fallback reads activity headers only and excludes drafts/subagent human prompts", async () =>
  fixture(async (dir) => {
    const file = path.join(dir, "state.vscdb"),
      db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY,value TEXT);CREATE TABLE ItemTable(key TEXT,value TEXT)",
    );
    const insert = db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)");
    const time = Date.parse("2026-10-19T12:00:00Z");
    insert.run(
      "composerData:root",
      JSON.stringify({
        composerId: "root",
        createdAt: time,
        subComposerIds: ["child"],
        fullConversationHeadersOnly: [
          { bubbleId: "human", type: 1 },
          { bubbleId: "response", type: 2 },
        ],
        text: "private-transcript",
      }),
    );
    insert.run(
      "composerData:child",
      JSON.stringify({
        composerId: "child",
        createdAt: time,
        fullConversationHeadersOnly: [{ bubbleId: "agent-prompt", type: 1 }],
      }),
    );
    insert.run(
      "composerData:draft",
      JSON.stringify({
        composerId: "draft",
        createdAt: time,
        isDraft: true,
        fullConversationHeadersOnly: [{ bubbleId: "unsent", type: 1 }],
      }),
    );
    db.prepare("INSERT INTO ItemTable VALUES (?,?)").run(
      "auth",
      "private-credential",
    );
    db.close();
    process.env.CURSOR_DB_PATH = file;
    const s = await collectCursorUsage();
    assert.equal(s.totals.sessions, 2);
    assert.equal(s.totals.humanRequests, 1);
    assert.equal(s.availability?.tokens, false);
    assert.equal(s.availability?.assistantRequests, false);
    assert.equal(s.availability?.sessions, true);
    assert.ok(!JSON.stringify(s).includes("private"));
  }));
test("Cursor CSV cache notices updated exports and explicit file overrides directory", async () =>
  fixture(async (dir) => {
    const file = path.join(dir, "a.csv");
    await writeFile(file, header + "\n" + row);
    assert.equal((await collectCursorUsage()).totals.totalTokens, 18);
    assert.equal((await collectCursorUsage()).totals.totalTokens, 18);
    await writeFile(file, header + "\n" + row + "\n" + row);
    assert.equal((await collectCursorUsage()).totals.totalTokens, 36);
    await mkdir(path.join(dir, "nested"));
    const explicit = path.join(dir, "nested/export.csv");
    await writeFile(explicit, header + "\n" + row);
    process.env.CURSOR_USAGE_CSV = explicit;
    assert.equal((await collectCursorUsage()).totals.totalTokens, 18);
  }));
test("Cursor API-equivalent estimate uses flat provider cache rates without inferring request context tier", () => {
  const tokens = {
    inputTokens: 1_000_000,
    cachedInputTokens: 900_000,
    cacheWriteTokens: 50_000,
    outputTokens: 1_000,
    reasoningTokens: 0,
    totalTokens: 1_001_000,
  };
  assert.equal(estimateCursorCost("claude-4-sonnet", tokens), 0.6225);
  assert.equal(estimateCursorCost("auto", tokens), null);
  // Composer 1: $1.25 in / $0.125 cached / $10 out per 1M.
  assert.equal(estimateCursorCost("composer-1", tokens), 0.2475);
});

test("Cursor local cache invalidates on WAL-only activity updates", async () =>
  fixture(async (dir) => {
    const file = path.join(dir, "wal.vscdb"),
      db = new DatabaseSync(file);
    db.exec(
      "PRAGMA journal_mode=WAL;CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY,value TEXT)",
    );
    const insert = db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)"),
      time = Date.parse("2026-10-19T12:00:00Z");
    const conversation = (id: string) =>
      JSON.stringify({
        composerId: id,
        createdAt: time,
        fullConversationHeadersOnly: [{ bubbleId: `human-${id}`, type: 1 }],
      });
    insert.run("composerData:first", conversation("first"));
    process.env.CURSOR_DB_PATH = file;
    try {
      assert.equal((await collectCursorUsage()).totals.sessions, 1);
      insert.run("composerData:second", conversation("second"));
      const result = await collectCursorUsage();
      assert.equal(result.totals.sessions, 2);
      assert.equal(result.totals.humanRequests, 2);
    } finally {
      db.close();
    }
  }));
test("Cursor CSV keeps tokens from the export while local history supplies activity beyond it", async () =>
  fixture(async (dir) => {
    await writeFile(path.join(dir, "usage.csv"), header + "\n" + row);
    const file = path.join(dir, "state.vscdb"),
      db = new DatabaseSync(file);
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY,value TEXT)");
    const insert = db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)");
    for (const [id, iso] of [
      ["old", "2025-08-01T12:00:00Z"],
      ["mid", "2026-03-05T12:00:00Z"],
      ["csv-day", "2026-10-19T12:00:00Z"],
    ])
      insert.run(
        `composerData:${id}`,
        JSON.stringify({
          composerId: id,
          createdAt: Date.parse(iso),
          fullConversationHeadersOnly: [
            { bubbleId: `${id}-human`, type: 1 },
            { bubbleId: `${id}-response`, type: 2 },
          ],
        }),
      );
    db.close();
    process.env.CURSOR_DB_PATH = file;
    const s = await collectCursorUsage();
    assert.doesNotThrow(() => validateSnapshot(s));
    // Tokens still come only from the CSV...
    assert.equal(s.totals.totalTokens, 18);
    assert.equal(s.availability?.tokens, true);
    // ...but activity now spans the whole retained local history.
    assert.equal(s.availability?.sessions, true);
    assert.equal(s.availability?.humanRequests, true);
    assert.equal(s.totals.sessions, 3);
    assert.equal(s.totals.humanRequests, 3);
    assert.deepEqual(
      s.daily.filter((d) => d.humanRequests > 0).map((d) => d.date),
      ["2025-08-01", "2026-03-05", "2026-10-19"],
    );
    assert.equal(s.coverage.firstEvent, "2025-08-01T12:00:00.000Z");
    assert.equal(s.coverage.lastEvent, "2026-10-19T12:00:00.000Z");
    assert.ok(s.coverage.warnings.some((w) => /only covers/.test(w)));
  }));
test("Cursor CSV survives an unreadable local database", async () =>
  fixture(async (dir) => {
    await writeFile(path.join(dir, "usage.csv"), header + "\n" + row);
    const file = path.join(dir, "state.vscdb");
    await writeFile(file, "this is not a sqlite database");
    process.env.CURSOR_DB_PATH = file;
    const s = await collectCursorUsage();
    assert.equal(s.totals.totalTokens, 18);
    assert.equal(s.availability?.sessions, false);
    assert.ok(s.coverage.warnings.some((w) => /could not be read/.test(w)));
  }));
