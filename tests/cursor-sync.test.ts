import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectCursorUsage } from "../lib/cursor-collector";
import { resetCursorSyncCache, normalizeModel } from "../lib/cursor-sync";
import { validateSnapshot } from "../lib/validation";

const ENDPOINT = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = (exp = Math.floor(Date.now() / 1000) + 3600) =>
  `${b64({ alg: "none" })}.${b64({ sub: "auth0|user_TESTUSER12345", exp })}.signature-secret`;

type Call = { url: string; init: RequestInit };
type Raw = Record<string, unknown>;
const ev = (iso: string, model: string, usage: Raw, extra: Raw = {}): Raw => ({
  timestamp: String(Date.parse(iso)),
  model,
  kind: "USAGE_EVENT_KIND_INCLUDED_IN_PRO",
  tokenUsage: usage,
  ...extra,
});

async function fixture(
  token: string | null,
  run: (ctx: { dir: string; calls: Call[]; serve: (f: (call: Call) => Response) => void }) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "cursor-sync-test-"));
  const names = ["CURSOR_USAGE_DIR", "CURSOR_USAGE_CSV", "CURSOR_DB_PATH", "CURSOR_AUTO_SYNC"];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  const realFetch = globalThis.fetch;
  const calls: Call[] = [];
  let handler: (call: Call) => Response = () => new Response("{}", { status: 500 });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  const file = path.join(dir, "state.vscdb");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY,value TEXT);CREATE TABLE ItemTable (key TEXT UNIQUE,value BLOB)");
  if (token) db.prepare("INSERT INTO ItemTable VALUES (?,?)").run("cursorAuth/accessToken", token);
  db.close();
  process.env.CURSOR_USAGE_DIR = dir;
  delete process.env.CURSOR_USAGE_CSV;
  process.env.CURSOR_DB_PATH = file;
  process.env.CURSOR_AUTO_SYNC = "true";
  resetCursorSyncCache();
  try {
    await run({ dir, calls, serve: (f) => (handler = f) });
  } finally {
    globalThis.fetch = realFetch;
    resetCursorSyncCache();
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
const page = (events: Raw[], total = events.length) =>
  Response.json({ totalUsageEventsCount: total, usageEventsDisplay: events });

test("Cursor auto-sync is off unless explicitly enabled and then never reads or sends anything", async () =>
  fixture(jwt(), async ({ calls }) => {
    delete process.env.CURSOR_AUTO_SYNC;
    const s = await collectCursorUsage();
    assert.equal(calls.length, 0);
    assert.equal(s.availability?.tokens, false);
  }));

test("Cursor auto-sync maps account events, prices what it can and uses Cursor's cost for the rest", async () =>
  fixture(jwt(), async ({ calls, serve }) => {
    const token = jwt();
    serve(() =>
      page([
        ev("2026-03-01T10:00:00Z", "claude-4-sonnet", { inputTokens: 100, cacheWriteTokens: 200, cacheReadTokens: 300, outputTokens: 50, totalCents: 1 }, { conversationId: "c1" }),
        ev("2026-03-02T10:00:00Z", "default", { inputTokens: 10, cacheReadTokens: 1000, outputTokens: 20, totalCents: 250 }),
        ev("2026-03-02T11:00:00Z", "Premium (Codex 5.3)", { inputTokens: 5, outputTokens: 5 }),
      ]),
    );
    const s = await collectCursorUsage();
    assert.doesNotThrow(() => validateSnapshot(s));
    // One POST to the fixed endpoint, never following redirects, as a browser would.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, ENDPOINT);
    assert.equal(calls[0].init.redirect, "manual");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Origin, "https://cursor.com");
    assert.match(headers.Cookie, /^WorkosCursorSessionToken=user_TESTUSER12345%3A%3A/);
    // Token fields: input = fresh + cache read + cache write.
    assert.equal(s.totals.inputTokens, 100 + 300 + 200 + 10 + 1000 + 5);
    assert.equal(s.totals.cachedInputTokens, 1300);
    assert.equal(s.totals.cacheWriteTokens, 200);
    assert.equal(s.totals.outputTokens, 75);
    assert.equal(s.availability?.tokens, true);
    assert.equal(s.availability?.cost, true);
    const byModel = Object.fromEntries(s.models.map((m) => [m.model, m]));
    // "default" is the Auto router; its price comes from Cursor's reported cents.
    assert.ok(byModel.auto);
    assert.ok(Math.abs(byModel.auto.costUsd - 2.5) < 1e-9);
    assert.equal(byModel.auto.priced, true);
    assert.equal(byModel.auto.unpricedTokens, 0);
    // No published price and no reported cost: stays visibly unpriced.
    assert.equal(byModel["Premium-Codex-5.3"].priced, false);
    assert.equal(byModel["Premium-Codex-5.3"].unpricedTokens, 10);
    // Published-price models still use the estimate, not the reported cents.
    assert.ok(byModel["claude-4-sonnet"].costUsd > 0);
    assert.notEqual(byModel["claude-4-sonnet"].costUsd, 0.01);
    // Secrets and identifiers never reach the snapshot.
    const text = JSON.stringify(s);
    for (const secret of [token.split(".")[2], "signature-secret", "user_TESTUSER12345", "WorkosCursorSessionToken", "c1"])
      assert.ok(!text.includes(secret), secret);
  }));

test("Cursor auto-sync pages through large accounts and tolerates missing or repeated event IDs", async () =>
  fixture(jwt(), async ({ calls, serve }) => {
    const all = Array.from({ length: 1500 }, (_, i) =>
      ev(new Date(Date.parse("2026-01-01T00:00:00Z") + Math.floor(i / 2) * 1000).toISOString(), "gpt-5", { inputTokens: 1, outputTokens: 1 }, { usageEventId: "same-id" }),
    );
    serve((call) => {
      const body = JSON.parse(String(call.init.body));
      assert.equal(body.pageSize, 1000);
      return page(all.slice((body.page - 1) * 1000, body.page * 1000), all.length);
    });
    const s = await collectCursorUsage();
    assert.equal(calls.length, 2);
    // Pairs of identical rows stay distinct requests; duplicated IDs don't merge them.
    assert.equal(s.totals.assistantRequests, 1500);
    assert.equal(s.totals.totalTokens, 3000);
  }));

test("Cursor auto-sync replaces overlapping CSV rows but keeps earlier imported history", async () =>
  fixture(jwt(), async ({ dir, serve }) => {
    const header = "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";
    await writeFile(
      path.join(dir, "old.csv"),
      [header, "2025-01-10T00:00:00Z,Included,gpt-5,No,0,1,0,1,2,Included", "2026-03-01T10:00:00Z,Included,gpt-5,No,0,1,0,1,2,Included"].join("\n"),
    );
    serve(() => page([ev("2026-03-01T10:00:00Z", "gpt-5", { inputTokens: 1, outputTokens: 1 })]));
    const s = await collectCursorUsage();
    // The in-range CSV row duplicates the API event and is dropped; the older row survives.
    assert.equal(s.totals.assistantRequests, 2);
    assert.equal(s.totals.totalTokens, 4);
  }));

test("Cursor auto-sync degrades with a visible warning when the login is missing, expired or rejected", async () => {
  await fixture(null, async ({ calls }) => {
    const s = await collectCursorUsage();
    assert.equal(calls.length, 0);
    assert.equal(s.availability?.tokens, false);
    assert.ok(s.coverage.warnings.some((w) => /signed-in Cursor session/.test(w)));
  });
  await fixture(jwt(Math.floor(Date.now() / 1000) - 10), async ({ calls }) => {
    const s = await collectCursorUsage();
    assert.equal(calls.length, 0);
    assert.ok(s.coverage.warnings.some((w) => /expired/.test(w)));
  });
  await fixture(jwt(), async ({ calls, serve }) => {
    serve(() => new Response("nope", { status: 401 }));
    const first = await collectCursorUsage();
    assert.equal(first.availability?.tokens, false);
    assert.ok(first.coverage.warnings.some((w) => /rejected the saved login/.test(w)));
    // A failed sync backs off instead of re-sending the credential every poll.
    await collectCursorUsage();
    assert.equal(calls.length, 1);
  });
});

test("Cursor auto-sync rejects redirects and malformed events without trusting them", async () =>
  fixture(jwt(), async ({ serve }) => {
    serve(() => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }));
    const redirected = await collectCursorUsage();
    assert.equal(redirected.availability?.tokens, false);
    resetCursorSyncCache();
    serve(() =>
      page([
        ev("2026-03-01T10:00:00Z", "gpt-5", { inputTokens: -5, outputTokens: 1 }),
        ev("2026-03-01T10:00:01Z", "gpt-5", { inputTokens: 1.5, outputTokens: 1 }),
        { timestamp: "not-a-date", model: "gpt-5", tokenUsage: { inputTokens: 1 } },
        ev("2026-03-01T10:00:02Z", "gpt-5", { inputTokens: 2, outputTokens: 3 }),
      ]),
    );
    const s = await collectCursorUsage();
    assert.equal(s.totals.assistantRequests, 1);
    assert.equal(s.totals.totalTokens, 5);
    assert.equal(s.coverage.malformedLines, 3);
  }));

test("Cursor auto-sync caches between polls instead of re-requesting on every refresh", async () =>
  fixture(jwt(), async ({ calls, serve }) => {
    serve(() => page([ev("2026-03-01T10:00:00Z", "gpt-5", { inputTokens: 1, outputTokens: 1 })]));
    await collectCursorUsage();
    await collectCursorUsage();
    assert.equal(calls.length, 1);
  }));

test("Cursor model names are normalized to the snapshot model pattern", () => {
  assert.equal(normalizeModel("default"), "auto");
  assert.equal(normalizeModel("Premium (Codex 5.3)"), "Premium-Codex-5.3");
  assert.equal(normalizeModel("qwen2.5-coder:14b-instruct"), "qwen2.5-coder:14b-instruct");
  assert.equal(normalizeModel(""), "unknown");
  assert.equal(normalizeModel(42), "unknown");
  assert.equal(normalizeModel("a".repeat(300)).length, 100);
});
