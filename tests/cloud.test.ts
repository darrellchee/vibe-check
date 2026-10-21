import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectUsage } from "../lib/collector";
import { sessionToken } from "../lib/auth";
import { POST as ingest } from "../app/api/ingest/route";
import { GET as usage } from "../app/api/usage/route";
import { GET as widget } from "../app/api/widget/route";

test("cloud upload/read/widget roundtrip persists only sanitized aggregates and rejects stale uploads", async () => {
  // Mock the Upstash HTTP command boundary, not the app routes or validation.
  const env: Record<string, string | undefined> = process.env;
  const values = {
    ATLAS_MODE: "cloud",
    SYNC_TOKEN: "cloud-fixture-private-token-1234567890",
    DASHBOARD_PASSWORD: "cloud-fixture-password",
    UPSTASH_REDIS_REST_URL: "https://storage.example",
    UPSTASH_REDIS_REST_TOKEN: "storage-fixture-secret",
    NODE_ENV: "production",
    PUBLIC_WIDGET: undefined,
  };
  const before = Object.fromEntries(
    Object.keys(values).map((key) => [key, env[key]]),
  );
  const realFetch = globalThis.fetch;
  let stored: string | null = null;
  let storageCalls = 0;
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://storage.example");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer storage-fixture-secret",
      );
      storageCalls++;
      const command = JSON.parse(String(init?.body));
      if (command[0] === "GET") return Response.json({ result: stored });
      assert.equal(command[0], "EVAL");
      assert.equal(command[2], 1);
      if (stored && JSON.parse(stored).generatedAt >= command[4])
        return Response.json({ result: 0 });
      stored = command[5];
      return Response.json({ result: 1 });
    };
    const snapshot = await collectUsage(
      path.join(tmpdir(), `missing-atlas-fixture-${randomUUID()}`),
    );
    const upload = (value: unknown, authorized = true) =>
      new Request("https://dashboard.example/api/ingest", {
        method: "POST",
        headers: {
          ...(authorized
            ? { Authorization: `Bearer ${values.SYNC_TOKEN}` }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(value),
      });
    assert.equal((await ingest(upload(snapshot, false))).status, 401);
    assert.equal(storageCalls, 0);
    assert.equal(
      (await ingest(upload({ ...snapshot, transcript: "must never persist" })))
        .status,
      400,
    );
    assert.equal(storageCalls, 0);
    assert.equal((await ingest(upload(snapshot))).status, 200);
    assert.equal((JSON.parse(stored!) as { source: string }).source, "cloud");
    assert.equal(stored!.includes("must never persist"), false);
    assert.equal((await ingest(upload(snapshot))).status, 409);
    const older = {
      ...snapshot,
      generatedAt: new Date(
        Date.parse(snapshot.generatedAt) - 1000,
      ).toISOString(),
    };
    assert.equal((await ingest(upload(older))).status, 409);
    const read = () =>
      new Request("https://dashboard.example/api/usage", {
        headers: {
          cookie: `atlas_session=${sessionToken(values.DASHBOARD_PASSWORD)}`,
        },
      });
    assert.equal(
      (await usage(new Request("https://dashboard.example/api/usage"))).status,
      401,
    );
    const response = await usage(read());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(body.generatedAt, snapshot.generatedAt);
    assert.equal(body.source, "cloud");
    for (const secret of [
      values.SYNC_TOKEN,
      values.DASHBOARD_PASSWORD,
      values.UPSTASH_REDIS_REST_TOKEN,
    ])
      assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal((await widget()).status, 404);
    env.PUBLIC_WIDGET = "true";
    const badge = await widget();
    assert.equal(badge.status, 200);
    assert.equal(badge.headers.get("content-type"), "image/svg+xml");
    const svg = await badge.text();
    assert.ok(svg.includes("RECORDED TOKENS"));
    assert.equal(svg.includes("source"), false);
    assert.equal(svg.includes("private-token"), false);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
});
