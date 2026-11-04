import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectUsage } from "../lib/collector";
import { calendarEmbed, cardOptions, deploymentUrl, profileEmbed, renderActivityCalendar, renderProfileCard, UPSTREAM_REPOSITORY } from "../lib/profile-card";
import { combineSnapshots } from "../lib/overview";
import { STORAGE_PROVIDERS } from "../lib/storage-providers";
import { GET as card } from "../app/api/card/route";
import { GET as usage } from "../app/api/usage/route";

test("README URLs encode selected options and reject credentials, local URLs and Markdown injection", () => {
  const embed = profileEmbed("https://vibe-check.example", "claude", "light", ["tokens", "requests"]);
  assert.equal(new URL(embed.image).searchParams.get("metrics"), "tokens,requests");
  assert.equal(new URL(embed.image).searchParams.get("provider"), "claude");
  assert.equal(embed.markdown, `![My recorded Claude Code usage](${embed.image})`);
  for (const url of ["http://localhost:3000", "javascript:alert(1)", "https://user:secret@vibe-check.example", "https://vibe-check.example/path", "https://vibe-check.example/?secret=x", "https://vibe-check.example/#x", "https://vibe-check.example/)\n![x](https://evil.example)"])
    assert.throws(() => profileEmbed(url, "codex", "dark", ["tokens"]));
});

test("deploy button is one click: provisions one database and asks for no secrets", () => {
  const deploy = new URL(deploymentUrl());
  assert.equal(deploy.origin, "https://vercel.com");
  assert.equal(deploy.searchParams.get("repository-url"), UPSTREAM_REPOSITORY);
  assert.equal(deploy.searchParams.has("env"), false);
  // Upstash by default; an existing database can be connected instead of creating one.
  assert.deepEqual(JSON.parse(deploy.searchParams.get("stores")!), [
    { type: "integration", integrationSlug: "upstash", productSlug: "upstash-kv", protocol: "storage", allowConnectExistingProduct: true },
  ]);
  const slugs = STORAGE_PROVIDERS.map(({ id }) => {
    const stores = JSON.parse(new URL(deploymentUrl(undefined, { storage: id })).searchParams.get("stores")!);
    assert.equal(stores.length, 1); // Vercel creates every listed store, so each button asks for exactly one.
    return `${stores[0].integrationSlug}/${stores[0].productSlug}`;
  });
  assert.deepEqual(slugs, ["upstash/upstash-kv", "neon/neon", "tursocloud/database", "redis/redis", "supabase/supabase"]);
  assert.equal(new URL(deploymentUrl("https://github.com/developer/vibe-check")).searchParams.get("repository-url"), "https://github.com/developer/vibe-check");
  for (const repo of ["https://github.com.attacker.example/a/b", "https://github.com/a/b/tree/main", "https://github.com/a/b?token=secret", "https://user:secret@github.com/a/b"])
    assert.throws(() => deploymentUrl(repo));
});

test("deploy button sends the user back to setup only when asked", () => {
  assert.equal(new URL(deploymentUrl()).searchParams.has("redirect-url"), false);
  const deploy = deploymentUrl(undefined, { redirect: "http://localhost:3000/setup" });
  assert.equal(new URL(deploy).searchParams.get("redirect-url"), "http://localhost:3000/setup");
  assert.ok(deploy.includes("redirect-url=http%3A%2F%2Flocalhost%3A3000%2Fsetup"));
});

test("card accepts only safe options and never emits source strings or unselected metrics", async () => {
  for (const query of ["theme=evil", "theme=dark&theme=light", "metrics=price", "metrics=tokens,tokens", "metrics=tokens&metrics=sessions", "metrics=tokens,", "metrics=<script>"])
    assert.throws(() => cardOptions(new URL(`https://vibe-check.example/api/card?${query}`)));
  const snapshot = await collectUsage(path.join(tmpdir(), randomUUID()));
  snapshot.totals.totalTokens = 123456;
  snapshot.totals.sessions = 9;
  snapshot.totals.humanRequests = 27;
  snapshot.coverage.warnings = ["<script>private-project-path</script>"];
  snapshot.generatedAt = "2026-01-01T00:00:00.000Z";
  const svg = renderProfileCard(snapshot, "codex", "light", ["tokens", "requests"]);
  assert.match(svg, /123.5K/);
  assert.match(svg, /HUMAN REQUESTS/);
  assert.doesNotMatch(svg, /<text[^>]*>(Last synced|Updated) 20|not verified account lifetime<\/text>/); // no footer; the <desc> keeps the note
  assert.match(svg, /<title/);
  assert.match(svg, /#fafbf7/);
  for (const privateValue of ["SESSIONS", "private-project-path", "<script>", "costUsd"])
    assert.equal(svg.includes(privateValue), false);
  snapshot.availability = { tokens: false, cost: false, sessions: false, humanRequests: true, assistantRequests: false, cacheBreakdown: false };
  const cursor = renderProfileCard(snapshot, "cursor", "dark", ["tokens", "sessions", "requests"]);
  assert.match(cursor, /CURSOR USAGE/);
  assert.equal((cursor.match(/>Unavailable<\/text>/g) || []).length, 2);
  assert.equal(cursor.includes("123.5K"), false);
});

test("public cards require provider opt-in, fail closed, and never unlock private usage", async () => {
  const settings = { VIBE_CHECK_MODE: "cloud", PUBLIC_WIDGET: undefined, PUBLIC_CLAUDE_WIDGET: undefined,
    UPSTASH_REDIS_REST_URL: "https://storage.example", UPSTASH_REDIS_REST_TOKEN: "private-redis-token",
    DASHBOARD_PASSWORD: "private-dashboard-password" };
  const before = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  const realFetch = globalThis.fetch;
  let snapshot: unknown = await collectUsage(path.join(tmpdir(), randomUUID())), reads = 0;
  const request = (query = "") => new Request(`https://vibe-check.example/api/card${query}`);
  try {
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    globalThis.fetch = async (_url, init) => {
      const command = JSON.parse(String(init?.body));
      // The unclaimed-instance lookup is allowed; reading a snapshot while private is not.
      if (String(command[1]).includes("instance")) return Response.json({ result: null });
      reads++;
      return Response.json({ result: snapshot ? JSON.stringify(snapshot) : null });
    };
    const disabled = await card(request());
    assert.equal(disabled.status, 404);
    assert.equal(disabled.headers.get("cache-control"), "no-store");
    assert.equal(reads, 0);
    process.env.PUBLIC_WIDGET = "true";
    const response = await card(request("?theme=light&metrics=tokens"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /image\/svg\+xml/);
    assert.match(response.headers.get("cache-control")!, /max-age=300/);
    assert.match(response.headers.get("content-security-policy")!, /sandbox/);
    assert.equal((await card(request("?provider=claude"))).status, 404);
    assert.equal((await usage(new Request("https://vibe-check.example/api/usage"))).status, 401);
    assert.equal((await card(request("?provider=unknown"))).status, 400);
    assert.equal((await card(request("?metrics=price"))).status, 400);
    process.env.PUBLIC_CLAUDE_WIDGET = "true";
    assert.equal((await card(request("?provider=claude"))).status, 503);
    snapshot = null;
    assert.equal((await card(request())).status, 503);
    globalThis.fetch = async () => { throw new Error("private provider error"); };
    const failure = await card(request());
    assert.equal(failure.status, 503);
    assert.equal((await failure.text()).includes("private"), false);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("the All card shows total tokens, sessions and the estimated cost across harnesses", async () => {
  const make = async (tokens: number, sessions: number, costUsd: number) => {
    const snapshot = await collectUsage(path.join(tmpdir(), randomUUID()));
    snapshot.generatedAt = "2026-01-01T00:00:00.000Z";
    snapshot.totals = { ...snapshot.totals, totalTokens: tokens, sessions, costUsd };
    snapshot.daily = [{ ...snapshot.totals, date: "2025-12-30", models: [], totalTokens: tokens, sessions, costUsd }];
    return snapshot;
  };
  const all = combineSnapshots([await make(1_500_000_000, 300, 1200), await make(500_000_000, 218, 340.5)])!;
  const svg = renderProfileCard(all, "all", "dark", ["tokens", "sessions", "cost"]);
  assert.match(svg, />MY TOTAL AI USAGE</);
  assert.match(svg, />2B</);
  assert.match(svg, />518</);
  assert.match(svg, />\$1\.5K</);
  assert.match(svg, /ESTIMATED COST/);
  const calendar = renderActivityCalendar(all, "all", "dark");
  assert.match(calendar, />MY TOTAL AI USAGE</);
  assert.match(calendar, /2B tokens · 1 active day/);
  // Cost is unavailable, not "$0", when no harness estimates it.
  all.availability = { ...all.availability!, cost: false };
  assert.match(renderProfileCard(all, "all", "dark", ["cost"]), />Unavailable</);
  assert.equal(new URL(profileEmbed("https://vibe-check.example", "all", "dark", ["tokens", "sessions", "cost"]).image).searchParams.get("provider"), "all");
  assert.equal(calendarEmbed("https://vibe-check.example", "all", "dark").alt, "My recorded AI coding activity");
  assert.throws(() => cardOptions(new URL("https://vibe-check.example/api/card?metrics=tokens,sessions,requests,cost")));
});

test("the public card endpoint serves provider=all only from harnesses whose cards are public", async () => {
  const env = ["VIBE_CHECK_MODE", "PUBLIC_WIDGET", "PUBLIC_CLAUDE_WIDGET", "PUBLIC_CURSOR_WIDGET", "PUBLIC_ANTIGRAVITY_WIDGET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "DASHBOARD_PASSWORD"];
  const before = Object.fromEntries(env.map((key) => [key, process.env[key]]));
  const realFetch = globalThis.fetch;
  const codex = await collectUsage(path.join(tmpdir(), randomUUID()));
  codex.totals.totalTokens = 4_000_000;
  const claude = { ...codex, provider: "claude" as const, totals: { ...codex.totals, totalTokens: 6_000_000 } };
  const fetched: string[] = [];
  try {
    Object.assign(process.env, { VIBE_CHECK_MODE: "cloud", UPSTASH_REDIS_REST_URL: "https://storage.example", UPSTASH_REDIS_REST_TOKEN: "t", DASHBOARD_PASSWORD: "p" });
    for (const key of ["PUBLIC_WIDGET", "PUBLIC_CLAUDE_WIDGET", "PUBLIC_CURSOR_WIDGET", "PUBLIC_ANTIGRAVITY_WIDGET"]) delete process.env[key];
    globalThis.fetch = async (_url, init) => {
      const command = JSON.parse(String(init?.body));
      if (String(command[1]).includes("instance")) return Response.json({ result: null });
      fetched.push(String(command[1]));
      const snapshot = String(command[1]).includes("claude") ? claude : String(command[1]).includes("codex") ? codex : null;
      return Response.json({ result: snapshot ? JSON.stringify(snapshot) : null });
    };
    const request = (query = "") => new Request(`https://vibe-check.example/api/card?provider=all${query}`);
    assert.equal((await card(request())).status, 404);
    assert.equal(fetched.length, 0);
    process.env.PUBLIC_WIDGET = "true";
    process.env.PUBLIC_CLAUDE_WIDGET = "false";
    let svg = await (await card(request("&metrics=tokens"))).text();
    assert.match(svg, />4M</);
    process.env.PUBLIC_CLAUDE_WIDGET = "true";
    const response = await card(request("&metrics=tokens"));
    svg = await response.text();
    assert.equal(response.status, 200);
    assert.match(svg, />10M</);
    assert.equal((await card(request("&kind=calendar"))).status, 200);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
