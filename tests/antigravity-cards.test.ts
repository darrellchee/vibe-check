import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectAntigravityUsage } from "../lib/antigravity-collector";
import { GET as card } from "../app/api/card/route";
import { GET as widget } from "../app/api/widget/route";
import { GET as usage } from "../app/api/usage/route";

// Antigravity inherits the product default: a claimed site publishes its stats
// cards without any provider-specific flag, an explicit env flag still wins, and
// any storage trouble fails closed (private).
const instance = (publicCards: boolean) =>
  JSON.stringify({
    v: 1,
    claimedAt: "2026-10-21T00:00:00.000Z",
    sessionSecret: "s".repeat(64),
    salt: "a".repeat(32),
    hash: "b".repeat(128),
    publicCards,
  });

test("claimed sites publish the Antigravity card by default; env flags and failures stay private", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "antigravity-cards-"));
  const keys = [
    "ATLAS_MODE",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "ANTIGRAVITY_HOME",
    "PUBLIC_ANTIGRAVITY_WIDGET",
    "DASHBOARD_PASSWORD",
    "SYNC_TOKEN",
  ];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  try {
    Object.assign(process.env, {
      ATLAS_MODE: "cloud",
      UPSTASH_REDIS_REST_URL: "https://storage.example",
      UPSTASH_REDIS_REST_TOKEN: "private-redis-token",
      ANTIGRAVITY_HOME: home, // empty: nothing from the real machine is read
      DASHBOARD_PASSWORD: "private-dashboard-password",
    });
    delete process.env.PUBLIC_ANTIGRAVITY_WIDGET;
    delete process.env.SYNC_TOKEN;
    const snapshot = await collectAntigravityUsage();
    let claimed = true,
      cardsOn = true,
      outage = false,
      snapshotReads = 0;
    globalThis.fetch = async (_url, init) => {
      if (outage) throw new Error("private storage failure");
      const command = JSON.parse(String(init?.body));
      if (String(command[1]).includes("instance"))
        return Response.json({ result: claimed ? instance(cardsOn) : null });
      snapshotReads++;
      return Response.json({ result: JSON.stringify(snapshot) });
    };
    const request = (route: string) =>
      new Request(`https://atlas.example/api/${route}?provider=antigravity`);

    // Default after claiming: public, as an image that carries no source strings.
    const cardResponse = await card(request("card"));
    assert.equal(cardResponse.status, 200);
    assert.match(cardResponse.headers.get("content-type")!, /image\/svg\+xml/);
    assert.match(cardResponse.headers.get("content-security-policy")!, /sandbox/);
    const svg = await cardResponse.text();
    assert.doesNotMatch(svg, /\.gemini|conversation|RESOURCE_EXHAUSTED/);
    const widgetResponse = await widget(request("widget"));
    assert.equal(widgetResponse.status, 200);
    assert.match(await widgetResponse.text(), /Antigravity/);

    // The private dashboard data stays behind the login.
    assert.equal((await usage(request("usage"))).status, 401);

    // An explicit flag always wins over the claimed-site default.
    process.env.PUBLIC_ANTIGRAVITY_WIDGET = "false";
    snapshotReads = 0;
    assert.equal((await card(request("card"))).status, 404);
    assert.equal((await widget(request("widget"))).status, 404);
    assert.equal(snapshotReads, 0, "a private card never reads the snapshot");
    delete process.env.PUBLIC_ANTIGRAVITY_WIDGET;

    // Opting the whole site out, an unclaimed site, and a storage outage all fail closed.
    cardsOn = false;
    assert.equal((await card(request("card"))).status, 404);
    cardsOn = true;
    claimed = false;
    assert.equal((await card(request("card"))).status, 404);
    claimed = true;
    outage = true;
    assert.equal((await card(request("card"))).status, 404);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(before))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await rm(home, { recursive: true, force: true });
  }
});
