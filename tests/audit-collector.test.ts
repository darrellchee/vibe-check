import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectUsage } from "../lib/collector";

async function collectRows(rows: unknown[]) {
  const home = await mkdtemp(path.join(tmpdir(), "atlas-audit-"));
  try {
    await mkdir(path.join(home, "sessions"));
    await writeFile(
      path.join(home, "sessions", "fixture.jsonl"),
      rows.map((r) => JSON.stringify(r)).join("\n"),
    );
    return await collectUsage(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
const row = (type: string, payload: unknown) => ({
  type,
  payload,
  timestamp: "2026-10-19T02:00:00.000Z",
});

test("malformed JSON values and payloads cannot crash collection or leak model objects", async () => {
  const data = await collectRows([
    null,
    [],
    3,
    row("turn_context", null),
    row("turn_context", []),
    row("session_meta", { id: "local-session" }),
    row("turn_context", { model: { private: "secret" } }),
    row("token_usage_record", {
      response_id: "local-response",
      model: { private: "secret" },
      usage: { input_tokens: 20, output_tokens: 10 },
    }),
  ]);
  assert.equal(data.coverage.malformedLines, 5);
  assert.equal(data.models[0].model, "unknown");
  assert.equal(data.totals.totalTokens, 30);
  assert.equal(JSON.stringify(data).includes("secret"), false);
});

test("mixed schema gaps are disclosed without double counting later records", async () => {
  const data = await collectRows([
    row("session_meta", { id: "local-session" }),
    row("event_msg", {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } },
    }),
    row("token_usage_record", {
      response_id: "response",
      usage: { input_tokens: 20, output_tokens: 10 },
    }),
    row("event_msg", {
      type: "token_count",
      info: { total_token_usage: { input_tokens: 120, output_tokens: 20 } },
    }),
  ]);
  assert.equal(data.totals.totalTokens, 30);
  assert.ok(
    data.coverage.warnings.some((w) =>
      w.includes("Earlier usage may be missing"),
    ),
  );
});

test("accepted timestamp offsets normalize before sorting and cloud export", async () => {
  const data = await collectRows([
    row("session_meta", { id: "local-session" }),
    {
      ...row("token_usage_record", {
        response_id: "later",
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
      timestamp: "2026-10-19T12:00:00+10:00",
    },
    {
      ...row("token_usage_record", {
        response_id: "earlier",
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
      timestamp: "2026-10-19T01:00:00Z",
    },
  ]);
  assert.equal(data.coverage.firstEvent, "2026-10-19T01:00:00.000Z");
  assert.equal(data.coverage.lastEvent, "2026-10-19T02:00:00.000Z");
});
