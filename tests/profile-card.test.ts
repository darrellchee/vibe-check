import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectUsage } from "../lib/collector";
import { cardOptions, deploymentUrl, profileEmbed, renderProfileCard, UPSTREAM_REPOSITORY } from "../lib/profile-card";
import { GET as card } from "../app/api/card/route";
import { GET as usage } from "../app/api/usage/route";

test("README URLs encode selected options and reject credentials, local URLs and Markdown injection", () => {
  const embed = profileEmbed("https://atlas.example", "claude", "light", ["tokens", "requests"]);
  assert.equal(new URL(embed.image).searchParams.get("metrics"), "tokens,requests");
  assert.equal(new URL(embed.image).searchParams.get("provider"), "claude");
  assert.equal(embed.markdown, `![My recorded Claude Code usage](${embed.image})`);
  for (const url of ["http://localhost:3000", "javascript:alert(1)", "https://user:secret@atlas.example", "https://atlas.example/path", "https://atlas.example/?secret=x", "https://atlas.example/#x", "https://atlas.example/)\n![x](https://evil.example)"])
    assert.throws(() => profileEmbed(url, "codex", "dark", ["tokens"]));
});

test("deploy button is one click: provisions Redis and asks for no secrets", () => {
  const deploy = new URL(deploymentUrl());
  assert.equal(deploy.origin, "https://vercel.com");
  assert.equal(deploy.searchParams.get("repository-url"), UPSTREAM_REPOSITORY);
  assert.equal(deploy.searchParams.has("env"), false);
  assert.deepEqual(JSON.parse(deploy.searchParams.get("stores")!), [
    { type: "integration", integrationSlug: "upstash", productSlug: "upstash-kv", protocol: "storage" },
  ]);
  assert.equal(new URL(deploymentUrl("https://github.com/developer/atlas")).searchParams.get("repository-url"), "https://github.com/developer/atlas");
  for (const repo of ["https://github.com.attacker.example/a/b", "https://github.com/a/b/tree/main", "https://github.com/a/b?token=secret", "https://user:secret@github.com/a/b"])
    assert.throws(() => deploymentUrl(repo));
});

test("card accepts only safe options and never emits source strings or unselected metrics", async () => {
  for (const query of ["theme=evil", "theme=dark&theme=light", "metrics=cost", "metrics=tokens,tokens", "metrics=tokens&metrics=sessions", "metrics=tokens,", "metrics=<script>"])
    assert.throws(() => cardOptions(new URL(`https://atlas.example/api/card?${query}`)));
  const snapshot = await collectUsage(path.join(tmpdir(), randomUUID()));
  snapshot.totals.totalTokens = 123456;
  snapshot.totals.sessions = 9;
  snapshot.totals.humanRequests = 27;
  snapshot.coverage.warnings = ["<script>private-project-path</script>"];
  snapshot.generatedAt = "2026-01-01T00:00:00.000Z";
  const svg = renderProfileCard(snapshot, "codex", "light", ["tokens", "requests"]);
  assert.match(svg, /123.5K/);
  assert.match(svg, /HUMAN REQUESTS/);
  assert.match(svg, /Last synced 2026-01-01 00:00 UTC/);
  assert.match(svg, /<title/);
  assert.match(svg, /#fafbf7/);
  for (const privateValue of ["SESSIONS", "private-project-path", "<script>", "costUsd"])
    assert.equal(svg.includes(privateValue), false);
  snapshot.availability = { tokens: false, cost: false, sessions: false, humanRequests: true, assistantRequests: false, cacheBreakdown: false };
  const cursor = renderProfileCard(snapshot, "cursor", "dark", ["tokens", "sessions", "requests"]);
  assert.match(cursor, /CURSOR ATLAS/);
  assert.equal((cursor.match(/>Unavailable<\/text>/g) || []).length, 2);
  assert.equal(cursor.includes("123.5K"), false);
});

test("public cards require provider opt-in, fail closed, and never unlock private usage", async () => {
  const settings = { ATLAS_MODE: "cloud", PUBLIC_WIDGET: undefined, PUBLIC_CLAUDE_WIDGET: undefined,
    UPSTASH_REDIS_REST_URL: "https://storage.example", UPSTASH_REDIS_REST_TOKEN: "private-redis-token",
    DASHBOARD_PASSWORD: "private-dashboard-password" };
  const before = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  const realFetch = globalThis.fetch;
  let snapshot: unknown = await collectUsage(path.join(tmpdir(), randomUUID())), reads = 0;
  const request = (query = "") => new Request(`https://atlas.example/api/card${query}`);
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
    assert.equal((await usage(new Request("https://atlas.example/api/usage"))).status, 401);
    assert.equal((await card(request("?provider=unknown"))).status, 400);
    assert.equal((await card(request("?metrics=cost"))).status, 400);
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
