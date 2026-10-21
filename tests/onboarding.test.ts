import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectUsage } from "../lib/collector";
import { installScript } from "../lib/install-script";
import { cardsPublic } from "../lib/instance";
import type { UsageProvider } from "../lib/types";
import { GET as status } from "../app/api/setup/status/route";
import { POST as claim } from "../app/api/setup/claim/route";
import { POST as ownerPair } from "../app/api/setup/pair/route";
import { POST as redeem } from "../app/api/pair/route";
import { POST as login } from "../app/api/login/route";
import { POST as ingest } from "../app/api/ingest/route";
import { GET as usage } from "../app/api/usage/route";
import { GET as card } from "../app/api/card/route";
import { GET as install } from "../app/api/install/route";

const env: Record<string, string | undefined> = process.env;
const ORIGIN = "https://atlas.example";

// A tiny in-memory stand-in for the Upstash REST API, covering the commands the app uses.
function fakeRedis() {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const c = JSON.parse(String(init?.body));
    const reply = (result: unknown) => Response.json({ result });
    switch (c[0]) {
      case "GET": return reply(kv.get(c[1]) ?? null);
      case "SET":
        if (c.includes("NX") && kv.has(c[1])) return reply(null);
        kv.set(c[1], c[2]);
        return reply("OK");
      case "GETDEL": { const v = kv.get(c[1]) ?? null; kv.delete(c[1]); return reply(v); }
      case "SADD": (sets.get(c[1]) ?? sets.set(c[1], new Set()).get(c[1])!).add(c[2]); return reply(1);
      case "SISMEMBER": return reply(sets.get(c[1])?.has(c[2]) ? 1 : 0);
      case "EVAL": {
        const prior = kv.get(c[3]);
        if (prior && JSON.parse(prior).generatedAt >= c[4]) return reply(0);
        kv.set(c[3], c[5]);
        return reply(1);
      }
      default: throw new Error(`Unexpected Redis command ${c[0]}`);
    }
  };
  return { kv, sets, fetch };
}

async function withDeployment(
  overrides: Record<string, string | undefined>,
  run: (redis: ReturnType<typeof fakeRedis>) => Promise<void>,
) {
  const settings: Record<string, string | undefined> = {
    ATLAS_MODE: undefined, VERCEL: "1", NODE_ENV: "production",
    UPSTASH_REDIS_REST_URL: "https://storage.example",
    UPSTASH_REDIS_REST_TOKEN: "storage-fixture-secret",
    KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined,
    DASHBOARD_PASSWORD: undefined, SYNC_TOKEN: undefined,
    PUBLIC_WIDGET: undefined, PUBLIC_CLAUDE_WIDGET: undefined, PUBLIC_CURSOR_WIDGET: undefined,
    ...overrides,
  };
  const before = Object.fromEntries(Object.keys(settings).map((k) => [k, env[k]]));
  const realFetch = globalThis.fetch;
  const redis = fakeRedis();
  try {
    for (const [k, v] of Object.entries(settings)) {
      if (v === undefined) delete env[k]; else env[k] = v;
    }
    globalThis.fetch = redis.fetch;
    await run(redis);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k]; else env[k] = v;
    }
  }
}

const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const cookieFrom = (response: Response) =>
  (response.headers.get("set-cookie") || "").split(";")[0];

test("an unclaimed deployment is locked everywhere and tells visitors to claim it", async () => {
  await withDeployment({}, async () => {
    assert.deepEqual(await (await status()).json(), { cloud: true, storage: "ok", claimed: false, managedByEnv: false });
    assert.equal((await usage(new Request(`${ORIGIN}/api/usage`))).status, 401);
    assert.equal((await card(new Request(`${ORIGIN}/api/card`))).status, 404);
    assert.equal((await ingest(post("/api/ingest", {}, { authorization: `Bearer ${"a".repeat(64)}` }))).status, 401);
    const attempt = await login(post("/api/login", { password: "guess" }));
    assert.equal(attempt.status, 503);
    assert.match((await attempt.json()).error, /\/setup/);
  });
});

test("claiming is first-writer-wins, same-origin only, and stores only hashes", async () => {
  await withDeployment({}, async (redis) => {
    const foreign = await claim(post("/api/setup/claim", undefined, { origin: "https://evil.example" }));
    assert.equal(foreign.status, 403);
    assert.equal(redis.kv.size, 0);

    const [a, b] = await Promise.all([claim(post("/api/setup/claim")), claim(post("/api/setup/claim"))]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const winner = a.status === 200 ? a : b;
    const body = await winner.clone().json();
    assert.equal(body.origin, ORIGIN);
    assert.match(body.pairingCode, /^[a-f0-9]{24}$/);
    assert.ok(body.password.length >= 20);
    const cookie = winner.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.equal(cookie.includes(body.password), false);

    const stored = [...redis.kv.values(), ...[...redis.sets.values()].flatMap((s) => [...s])].join("\n");
    assert.equal(stored.includes(body.password), false);
    assert.equal(stored.includes(body.pairingCode), false);
    assert.equal((await claim(post("/api/setup/claim"))).status, 409);
    assert.equal((await (await status()).json()).claimed, true);

    // The claim cookie signs the owner in; the generated password works too, wrong ones do not.
    const signedIn = await usage(new Request(`${ORIGIN}/api/usage`, { headers: { cookie: cookieFrom(winner) } }));
    assert.notEqual(signedIn.status, 401);
    assert.equal((await login(post("/api/login", { password: body.password }))).status, 200);
    assert.equal((await login(post("/api/login", { password: "wrong" }))).status, 401);
  });
});

test("connect codes are single use, mint per-machine tokens, and unlock uploads", async () => {
  await withDeployment({}, async (redis) => {
    const claimed = await claim(post("/api/setup/claim"));
    const { pairingCode } = await claimed.clone().json();
    const owner = cookieFrom(claimed);

    const redeemed = await redeem(post("/api/pair", { code: pairingCode }));
    assert.equal(redeemed.status, 200);
    const { token } = await redeemed.json();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal([...redis.sets.values()].flatMap((s) => [...s]).includes(token), false);
    assert.equal((await redeem(post("/api/pair", { code: pairingCode }))).status, 401);
    for (const bad of ["", "nope", "A".repeat(24), 42, null])
      assert.equal((await redeem(post("/api/pair", { code: bad }))).status, 401);

    const snapshot = await collectUsage(path.join(tmpdir(), `missing-${randomUUID()}`));
    const upload = (bearer: string) =>
      ingest(post("/api/ingest", snapshot, { authorization: `Bearer ${bearer}` }));
    assert.equal((await upload("b".repeat(64))).status, 401);
    assert.equal((await upload(token)).status, 200);

    // Owner can mint more codes; strangers cannot.
    assert.equal((await ownerPair(post("/api/setup/pair"))).status, 401);
    const second = await ownerPair(post("/api/setup/pair", undefined, { cookie: owner }));
    assert.equal(second.status, 200);
    const extra = await second.json();
    assert.equal(extra.expiresInSeconds, 900);
    assert.notEqual(extra.pairingCode, pairingCode);
  });
});

test("claimed instances publish cards for every provider by default, and env flags still override", async () => {
  await withDeployment({}, async () => {
    assert.equal(await cardsPublic("codex"), false); // unclaimed stays private
    await claim(post("/api/setup/claim"));
    for (const provider of ["codex", "claude", "cursor", "some-future-provider"])
      assert.equal(await cardsPublic(provider as UsageProvider), true);
    // Enabled but no sync yet: 503, not 404.
    assert.equal((await card(new Request(`${ORIGIN}/api/card?provider=claude`))).status, 503);
    env.PUBLIC_CLAUDE_WIDGET = "false";
    assert.equal(await cardsPublic("claude"), false);
    assert.equal((await card(new Request(`${ORIGIN}/api/card?provider=claude`))).status, 404);
    assert.equal(await cardsPublic("codex"), true);
  });
});

test("storage and environment overrides keep working: KV_* names and explicit passwords", async () => {
  await withDeployment(
    { UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined, KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "kv-secret" },
    async () => {
      assert.equal((await claim(post("/api/setup/claim"))).status, 200);
    },
  );
  await withDeployment(
    { DASHBOARD_PASSWORD: "operator-chosen-password", SYNC_TOKEN: "operator-chosen-sync-token-0123456789" },
    async () => {
      assert.equal((await claim(post("/api/setup/claim"))).status, 409); // env-managed instances cannot be claimed
      assert.equal((await login(post("/api/login", { password: "operator-chosen-password" }))).status, 200);
      const snapshot = await collectUsage(path.join(tmpdir(), `missing-${randomUUID()}`));
      const response = await ingest(post("/api/ingest", snapshot, { authorization: "Bearer operator-chosen-sync-token-0123456789" }));
      assert.equal(response.status, 200);
    },
  );
  await withDeployment({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined }, async () => {
    assert.deepEqual(await (await status()).json(), { cloud: true, storage: "missing" });
    assert.equal((await claim(post("/api/setup/claim"))).status, 503);
  });
});

test("install script is valid POSIX sh, pinned to this site, and refuses unsafe inputs", async () => {
  const script = installScript(ORIGIN, "https://github.com/darrellchee/vibe-check.git");
  assert.ok(script.includes(`SITE='${ORIGIN}'`));
  assert.equal(script.includes("__SITE__") || script.includes("__REPO__"), false);
  const syntax = spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  for (const site of ["http://evil.example", "https://a.example/path", "https://a.example'; rm -rf ~ #", "https://user@a.example"])
    assert.throws(() => installScript(site, "https://github.com/a/b.git"));
  for (const repo of ["https://evil.example/a/b.git", "https://github.com/a/b", "https://github.com/a/b.git'; id #"])
    assert.throws(() => installScript(ORIGIN, repo));

  // Bad codes are rejected before anything is cloned or installed.
  for (const code of ["", "short", "g".repeat(24), "a".repeat(23)]) {
    const run = spawnSync("sh", ["-s", "--", ...(code ? [code] : [])], { input: script, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /connect code|Usage/);
  }

  const response = await install(new Request(`${ORIGIN}/api/install`, { headers: { host: "atlas.example" } }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /shellscript/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok((await response.text()).includes(`SITE='${ORIGIN}'`));
  const hostile = await install(new Request(`${ORIGIN}/api/install`, { headers: { host: "a.example'; id #" } }));
  assert.equal(hostile.status, 400);
});
