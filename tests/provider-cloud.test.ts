import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { collectUsage } from "../lib/collector";
import { validateSnapshot } from "../lib/validation";
import { providerFromUrl } from "../lib/providers";
import { sessionToken } from "../lib/auth";
import { POST as ingest } from "../app/api/ingest/route";
import { GET as usage } from "../app/api/usage/route";
import { GET as widget } from "../app/api/widget/route";
import type { UsageSnapshot } from "../lib/types";

async function legacySnapshot() {
  const snapshot = await collectUsage(
    path.join(tmpdir(), `atlas-provider-missing-${randomUUID()}`),
  );
  delete snapshot.provider;
  return snapshot;
}

test("provider selectors are explicit, strict and backward compatible", () => {
  assert.equal(providerFromUrl("https://dashboard.example/api/usage"), "codex");
  assert.equal(
    providerFromUrl("https://dashboard.example/api/usage?provider=claude"),
    "claude",
  );
  for (const query of [
    "provider=",
    "provider=unknown",
    "provider=all",
    "provider=CLAUDE",
    "provider=codex&provider=claude",
    "provider=codex&provider=codex",
  ])
    assert.throws(() =>
      providerFromUrl(`https://dashboard.example/api/usage?${query}`),
    );
});

test("snapshot provider validation accepts legacy Codex and official Anthropic sources only", async () => {
  const legacy = await legacySnapshot();
  assert.equal(validateSnapshot(legacy), legacy);
  const claude: UsageSnapshot = {
    ...legacy,
    provider: "claude",
    pricing: {
      checkedAt: "2026-10-19",
      sources: [
        "https://platform.claude.com/docs/en/about-claude/pricing",
        "https://docs.claude.com/en/docs/about-claude/pricing",
        "https://www.anthropic.com/pricing",
      ],
    },
  };
  assert.equal(validateSnapshot(claude), claude);
  for (const provider of [null, undefined, "", "all", "CLAUDE", 1, {}, []])
    assert.throws(() => validateSnapshot({ ...legacy, provider }));
  for (const source of [
    "https://platform.claude.com.attacker.example/docs/pricing",
    "https://anthropic.com.attacker.example/pricing",
    "https://docs.anthropic.com@attacker.example/pricing",
    "http://docs.anthropic.com/pricing",
    "javascript:alert(1)",
  ])
    assert.throws(() =>
      validateSnapshot({
        ...claude,
        pricing: { ...claude.pricing, sources: [source] },
      }),
    );
});

test("cloud providers use independent storage, private reads and separate public widget opt-ins", async () => {
  const env: Record<string, string | undefined> = process.env;
  const settings = {
    ATLAS_MODE: "cloud",
    SYNC_TOKEN: "provider-qa-fixture-token-123456789012345",
    DASHBOARD_PASSWORD: "provider-qa-password",
    UPSTASH_REDIS_REST_URL: "https://provider-storage.example",
    UPSTASH_REDIS_REST_TOKEN: "provider-storage-fixture-secret",
    NODE_ENV: "production",
    PUBLIC_WIDGET: undefined,
    PUBLIC_CLAUDE_WIDGET: undefined,
  };
  const before = Object.fromEntries(
    Object.keys(settings).map((key) => [key, env[key]]),
  );
  const realFetch = globalThis.fetch;
  const stored = new Map<string, string>();
  let reads = 0;
  try {
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), settings.UPSTASH_REDIS_REST_URL);
      const command = JSON.parse(String(init?.body));
      if (command[0] === "GET") {
        // Instance lookups decide public/private; only snapshot reads would leak data.
        if (String(command[1]).includes("snapshot")) reads++;
        return Response.json({ result: stored.get(command[1]) || null });
      }
      assert.equal(command[0], "EVAL");
      const key = command[3],
        prior = stored.get(key);
      if (prior && JSON.parse(prior).generatedAt >= command[4])
        return Response.json({ result: 0 });
      stored.set(key, command[5]);
      return Response.json({ result: 1 });
    };
    const codex = await legacySnapshot();
    const claude: UsageSnapshot = {
      ...codex,
      provider: "claude",
      pricing: {
        checkedAt: "2026-10-19",
        sources: ["https://platform.claude.com/docs/en/about-claude/pricing"],
      },
    };
    const upload = (snapshot: unknown, query = "") =>
      new Request(`https://dashboard.example/api/ingest${query}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.SYNC_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(snapshot),
      });
    assert.equal((await ingest(upload(codex))).status, 200);
    assert.equal(
      (await ingest(upload(claude, "?provider=claude"))).status,
      200,
    );
    assert.deepEqual([...stored.keys()].sort(), [
      "claude-atlas:snapshot:v1",
      "codex-atlas:snapshot:v1",
    ]);
    assert.equal((await ingest(upload(codex, "?provider=claude"))).status, 400);
    assert.equal((await ingest(upload(claude))).status, 400);
    assert.equal((await ingest(upload(claude, "?provider=all"))).status, 400);
    assert.equal(
      (await ingest(upload(claude, "?provider=claude&provider=codex"))).status,
      400,
    );
    assert.equal(
      (await ingest(upload(claude, "?provider=claude"))).status,
      409,
    );
    const read = (query = "", authenticated = true) =>
      new Request(`https://dashboard.example/api/usage${query}`, {
        headers: authenticated
          ? {
              cookie: `atlas_session=${sessionToken(settings.DASHBOARD_PASSWORD)}`,
            }
          : {},
      });
    assert.equal((await usage(read("?provider=claude", false))).status, 401);
    const codexRead = await usage(read());
    assert.equal(codexRead.status, 200);
    assert.equal((await codexRead.json()).provider, undefined);
    const claudeRead = await usage(read("?provider=claude"));
    assert.equal(claudeRead.status, 200);
    assert.equal((await claudeRead.json()).provider, "claude");
    assert.equal(claudeRead.headers.get("cache-control"), "private, no-store");
    assert.equal((await usage(read("?provider=all"))).status, 400);
    const badge = (query = "") =>
      widget(new Request(`https://dashboard.example/api/widget${query}`));
    const beforeWidgets = reads;
    assert.equal((await badge()).status, 404);
    assert.equal((await badge("?provider=claude")).status, 404);
    assert.equal(reads, beforeWidgets);
    env.PUBLIC_WIDGET = "true";
    assert.equal((await badge()).status, 200);
    assert.equal((await badge("?provider=claude")).status, 404);
    env.PUBLIC_CLAUDE_WIDGET = "true";
    delete env.PUBLIC_WIDGET;
    assert.equal((await badge()).status, 404);
    const claudeBadge = await badge("?provider=claude");
    assert.equal(claudeBadge.status, 200);
    const svg = await claudeBadge.text();
    assert.ok(svg.includes("CLAUDE ATLAS"));
    assert.equal(svg.includes("CODEX ATLAS"), false);
    assert.equal(svg.includes(settings.SYNC_TOKEN), false);
    // Fail closed if a backing-store mistake puts another provider under the requested key.
    stored.set("claude-atlas:snapshot:v1", JSON.stringify(codex));
    assert.equal((await usage(read("?provider=claude"))).status, 503);
    assert.equal((await badge("?provider=claude")).status, 503);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
});

test("local snapshots remain separated and missing Claude data never falls back to Codex", async () => {
  const { mkdtemp, readFile, stat, rm } = await import("node:fs/promises");
  const { saveSnapshot, readSnapshot } = await import("../lib/storage");
  const folder = await mkdtemp(path.join(tmpdir(), "atlas-provider-storage-"));
  const oldCwd = process.cwd(),
    oldMode = process.env.ATLAS_MODE;
  try {
    const codex = await legacySnapshot();
    const claude: UsageSnapshot = { ...codex, provider: "claude" };
    process.chdir(folder);
    process.env.ATLAS_MODE = "local";
    await saveSnapshot(codex);
    assert.equal((await readSnapshot())?.provider, undefined);
    assert.equal(await readSnapshot("claude"), null);
    await saveSnapshot(claude);
    assert.equal((await readSnapshot("claude"))?.provider, "claude");
    assert.equal((await readSnapshot("codex"))?.provider, undefined);
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(folder, "data", "claude-snapshot.json"),
          "utf8",
        ),
      ).provider,
      "claude",
    );
    assert.equal(
      (await stat(path.join(folder, "data", "snapshot.json"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await stat(path.join(folder, "data", "claude-snapshot.json"))).mode &
        0o777,
      0o600,
    );
  } finally {
    process.chdir(oldCwd);
    if (oldMode === undefined) delete process.env.ATLAS_MODE;
    else process.env.ATLAS_MODE = oldMode;
    await rm(folder, { recursive: true, force: true });
  }
});
