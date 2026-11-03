import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { kv, storageBackend } from "../lib/kv";
import { collectUsage } from "../lib/collector";
import { GET as status } from "../app/api/setup/status/route";
import { POST as claim } from "../app/api/setup/claim/route";
import { POST as redeem } from "../app/api/pair/route";
import { POST as ingest } from "../app/api/ingest/route";
import { POST as ownerPair } from "../app/api/setup/pair/route";
import { POST as login } from "../app/api/login/route";
import { GET as usage } from "../app/api/usage/route";
import { checkStoreContract } from "./kv-contract";

const env: Record<string, string | undefined> = process.env;
const STORAGE_VARS = [
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN",
  "REDIS_URL", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "DATABASE_URL", "POSTGRES_URL",
];

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const all = { ...Object.fromEntries(STORAGE_VARS.map((k) => [k, undefined])), ...values };
  const before = Object.fromEntries(Object.keys(all).map((k) => [k, env[k]]));
  try {
    for (const [k, v] of Object.entries(all)) {
      if (v === undefined) delete env[k]; else env[k] = v;
    }
    await run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k]; else env[k] = v;
    }
  }
}

test("the database is picked from whichever integration's variables are set", async () => {
  await withEnv({}, () => assert.equal(storageBackend(), null));
  await withEnv({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" }, () =>
    assert.deepEqual(storageBackend(), { kind: "upstash", url: "https://kv.example", token: "t" }));
  // Vercel's Upstash integration also sets REDIS_URL; its REST API stays in use.
  await withEnv({ UPSTASH_REDIS_REST_URL: "https://up.example", UPSTASH_REDIS_REST_TOKEN: "t", REDIS_URL: "rediss://x:y@up.example:6379", DATABASE_URL: "postgres://a@b/c" }, () =>
    assert.equal(storageBackend()?.kind, "upstash"));
  await withEnv({ REDIS_URL: "redis://default:secret@redis.example:12345", DATABASE_URL: "postgres://a@b/c" }, () =>
    assert.deepEqual(storageBackend(), { kind: "redis", url: "redis://default:secret@redis.example:12345" }));
  await withEnv({ TURSO_DATABASE_URL: "libsql://db-org.aws-us-east-1.turso.io", TURSO_AUTH_TOKEN: "t" }, () =>
    assert.deepEqual(storageBackend(), { kind: "turso", url: "https://db-org.aws-us-east-1.turso.io", token: "t" }));
  await withEnv({ DATABASE_URL: "postgresql://u:p@ep-x-pooler.neon.tech/neondb?sslmode=require" }, () =>
    assert.equal(storageBackend()?.kind, "postgres"));
  await withEnv({ POSTGRES_URL: "postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres" }, () =>
    assert.equal(storageBackend()?.kind, "postgres"));
});

test("half-configured or insecure databases are refused, never silently swapped", async () => {
  for (const values of [
    { UPSTASH_REDIS_REST_URL: "https://up.example" },
    { UPSTASH_REDIS_REST_URL: "http://up.example", UPSTASH_REDIS_REST_TOKEN: "t" },
    { REDIS_URL: "https://redis.example" },
    { TURSO_DATABASE_URL: "libsql://db.turso.io" },
    { TURSO_DATABASE_URL: "http://db.turso.io", TURSO_AUTH_TOKEN: "t" },
    { DATABASE_URL: "mysql://u:p@db.example/app" },
    // A broken Upstash setup must not fall through to the Postgres database also present.
    { UPSTASH_REDIS_REST_TOKEN: "t", DATABASE_URL: "postgres://a@b/c" },
  ]) {
    await withEnv(values, () => {
      assert.throws(() => storageBackend(), Error, JSON.stringify(values));
      assert.throws(() => kv());
    });
  }
});

// A stand-in for Turso's HTTP API (Hrana over HTTP) that runs the statements on a real SQLite.
function fakeTurso(origin: string, token: string) {
  const db = new DatabaseSync(":memory:");
  let requests = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    assert.equal(String(input), `${origin}/v2/pipeline`);
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    requests++;
    const body = JSON.parse(String(init?.body)) as {
      requests: ({ type: "close" } | { type: "execute"; stmt: { sql: string; args: { type: string; value?: string }[] } })[];
    };
    const results = body.requests.map((request) => {
      if (request.type === "close") return { type: "ok", response: { type: "close" } };
      try {
        const args = request.stmt.args.map((a): SQLInputValue =>
          a.type === "null" ? null : a.type === "integer" ? Number(a.value) : String(a.value));
        const rows = db.prepare(request.stmt.sql).all(...args) as Record<string, SQLInputValue>[];
        const cols = Object.keys(rows[0] ?? {}).map((name) => ({ name }));
        const cell = (v: SQLInputValue) =>
          v === null ? { type: "null" } : typeof v === "number" || typeof v === "bigint" ? { type: "integer", value: String(v) } : { type: "text", value: String(v) };
        return { type: "ok", response: { type: "execute", result: { cols, rows: rows.map((r) => cols.map((c) => cell(r[c.name]))) } } };
      } catch (e) {
        return { type: "error", error: { message: (e as Error).message } };
      }
    });
    return Response.json({ baton: null, base_url: null, results });
  };
  return { db, fetch, requests: () => requests };
}

async function withTurso(run: (turso: ReturnType<typeof fakeTurso>) => Promise<void>) {
  const host = `db-${randomUUID().slice(0, 8)}.turso.example`;
  const turso = fakeTurso(`https://${host}`, "turso-fixture-token");
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = turso.fetch;
    await withEnv({ TURSO_DATABASE_URL: `libsql://${host}`, TURSO_AUTH_TOKEN: "turso-fixture-token" }, () => run(turso));
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("Turso keeps every storage guarantee, using real SQLite statements", async () => {
  await withTurso(async () => {
    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    try {
      await checkStoreContract(kv(), async (ms) => void (offset += ms));
    } finally {
      Date.now = realNow;
    }
  });
});

test("a Turso-backed deployment can be claimed, paired and uploaded to", async () => {
  const before = { VERCEL: env.VERCEL, NODE_ENV: env.NODE_ENV, VIBE_CHECK_MODE: env.VIBE_CHECK_MODE, DASHBOARD_PASSWORD: env.DASHBOARD_PASSWORD, SYNC_TOKEN: env.SYNC_TOKEN };
  Object.assign(env, { VERCEL: "1", NODE_ENV: "production" });
  for (const k of ["VIBE_CHECK_MODE", "DASHBOARD_PASSWORD", "SYNC_TOKEN"]) delete env[k];
  const origin = "https://vibe-check.example";
  const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`${origin}${url}`, { method: "POST", headers: { "Content-Type": "application/json", origin, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    await withTurso(async (turso) => {
      assert.deepEqual(await (await status()).json(), { cloud: true, storage: "ok", claimed: false, managedByEnv: false });
      const [a, b] = await Promise.all([claim(post("/api/setup/claim")), claim(post("/api/setup/claim"))]);
      assert.deepEqual([a.status, b.status].sort(), [200, 409]);
      const { pairingCode, password } = await (a.status === 200 ? a : b).json();

      const redeemed = await redeem(post("/api/pair", { code: pairingCode }));
      assert.equal(redeemed.status, 200);
      const { token } = await redeemed.json();
      assert.equal((await redeem(post("/api/pair", { code: pairingCode }))).status, 401);

      const snapshot = await collectUsage(path.join(tmpdir(), `missing-${randomUUID()}`));
      assert.equal((await ingest(post("/api/ingest", snapshot, { authorization: `Bearer ${token}` }))).status, 200);

      // Only hashes reach the database.
      const stored = JSON.stringify([
        ...turso.db.prepare("SELECT * FROM vibe_check_kv").all(),
        ...turso.db.prepare("SELECT * FROM vibe_check_set_members").all(),
      ]);
      for (const secret of [password, pairingCode, token]) assert.equal(stored.includes(secret), false);
      assert.ok(turso.requests() > 0);
    });
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k]; else env[k] = v;
    }
  }
});

test("a site deployed before the rename keeps its owner, password, computers and data", async () => {
  const before = { VERCEL: env.VERCEL, NODE_ENV: env.NODE_ENV, VIBE_CHECK_MODE: env.VIBE_CHECK_MODE, DASHBOARD_PASSWORD: env.DASHBOARD_PASSWORD, SYNC_TOKEN: env.SYNC_TOKEN };
  Object.assign(env, { VERCEL: "1", NODE_ENV: "production" });
  for (const k of ["VIBE_CHECK_MODE", "DASHBOARD_PASSWORD", "SYNC_TOKEN"]) delete env[k];
  const origin = "https://vibe-check.example";
  const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`${origin}${url}`, { method: "POST", headers: { "Content-Type": "application/json", origin, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    await withTurso(async (turso) => {
      // Set up a working site, with one computer connected, one unused code, and one upload.
      const claimed = await claim(post("/api/setup/claim"));
      const { pairingCode, password } = await claimed.clone().json();
      const owner = (claimed.headers.get("set-cookie") || "").split(";")[0];
      const { token } = await (await redeem(post("/api/pair", { code: pairingCode }))).json();
      const { pairingCode: unusedCode } = await (await ownerPair(post("/api/setup/pair", undefined, { cookie: owner }))).json();
      const snapshot = await collectUsage(path.join(tmpdir(), `missing-${randomUUID()}`));
      assert.equal((await ingest(post("/api/ingest", snapshot, { authorization: `Bearer ${token}` }))).status, 200);

      // Turn it into what an older deployment holds: every key under its old "atlas" name.
      turso.db.exec("UPDATE vibe_check_kv SET key = replace(key, 'vibe-check', 'atlas')");
      turso.db.exec("UPDATE vibe_check_set_members SET set_key = replace(set_key, 'vibe-check', 'atlas')");
      const keys = () => (turso.db.prepare("SELECT key FROM vibe_check_kv").all() as { key: string }[]).map((r) => r.key);
      assert.ok(keys().every((k) => k.includes("atlas")));

      // The first thing after the update is strangers trying to claim it. None may succeed.
      const attempts = await Promise.all([1, 2, 3].map(() => claim(post("/api/setup/claim"))));
      assert.deepEqual(attempts.map((r) => r.status), [409, 409, 409]);
      assert.equal((await (await status()).json()).claimed, true);

      // The owner's session, password, computer and data all still work.
      const read = await usage(new Request(`${origin}/api/usage`, { headers: { cookie: owner } }));
      assert.equal(read.status, 200);
      assert.ok(JSON.stringify(await read.json()).includes(snapshot.generatedAt), "old snapshot still shows");
      assert.equal((await login(post("/api/login", { password }))).status, 200);
      assert.equal((await login(post("/api/login", { password: "wrong" }))).status, 401);
      const newer = { ...snapshot, generatedAt: new Date(Date.parse(snapshot.generatedAt) + 60_000).toISOString() };
      assert.equal((await ingest(post("/api/ingest", newer, { authorization: `Bearer ${token}` }))).status, 200);
      assert.equal((await ingest(post("/api/ingest", snapshot, { authorization: `Bearer ${"e".repeat(64)}` }))).status, 401);

      // A code made just before the update still works, once.
      assert.equal((await redeem(post("/api/pair", { code: unusedCode }))).status, 200);
      assert.equal((await redeem(post("/api/pair", { code: unusedCode }))).status, 401);

      // Everything now lives under the new names.
      assert.ok(keys().includes("vibe-check:instance:v1"));
      assert.ok(keys().includes("codex-vibe-check:snapshot:v1"));
      const tokenSets = (turso.db.prepare("SELECT DISTINCT set_key FROM vibe_check_set_members").all() as { set_key: string }[]).map((r) => r.set_key);
      assert.ok(tokenSets.includes("vibe-check:sync-tokens:v1"));
    });
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k]; else env[k] = v;
    }
  }
});
