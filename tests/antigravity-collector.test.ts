import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectAntigravityUsage } from "../lib/antigravity-collector";
import {
  antigravityModelName,
  estimateAntigravityCost,
} from "../lib/antigravity-pricing";
import { fields, message, num, repeated } from "../lib/protobuf";
import { validateSnapshot } from "../lib/validation";

// --- tiny protobuf encoder: just enough to build fixture blobs
const varint = (n: number) => {
  const out: number[] = [];
  while (n >= 128) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Uint8Array.from(out);
};
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const key = (n: number, wire: number) => varint(n * 8 + wire);
const v = (n: number, value: number) => cat(key(n, 0), varint(value));
const len = (n: number, body: Uint8Array) =>
  cat(key(n, 2), varint(body.length), body);
const str = (n: number, s: string) => len(n, new TextEncoder().encode(s));
const packed = (n: number, values: number[]) =>
  len(n, cat(...values.map(varint)));
const stamp = (seconds: number) => len(1, v(1, seconds));

type Usage = {
  input?: number;
  cache?: number;
  output: number;
  thinking?: number;
};
function generation(options: {
  steps: number[];
  modelEnum: number;
  label?: string;
  usage?: Usage;
  error?: string;
  padding?: number;
}) {
  const parts: Uint8Array[] = [packed(2, options.steps)];
  if (options.usage) {
    const u = options.usage;
    const thinking = u.thinking ?? 0;
    const usage = cat(
      v(1, options.modelEnum),
      ...(u.input ? [v(2, u.input)] : []),
      v(3, u.output),
      ...(u.cache ? [v(5, u.cache)] : []),
      ...(thinking ? [v(9, thinking)] : []),
      v(10, u.output - thinking),
    );
    const body = cat(
      v(3, options.modelEnum),
      len(4, usage),
      ...(options.label ? [str(19, options.label)] : []),
    );
    parts.unshift(len(1, body));
    // Large trailing blobs (request snapshots) must not be skipped.
    if (options.padding) parts.push(len(7, new Uint8Array(options.padding)));
  } else if (options.error) parts.push(str(5, options.error));
  return cat(...parts);
}
// steps.metadata field 1 is the creation Timestamp {1: seconds}.
const stepMeta = (seconds: number) => stamp(seconds);

function createConversation(
  file: string,
  steps: { type: number; at: number }[],
  generations: Uint8Array[],
) {
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE steps (idx integer, step_type integer, status integer, metadata blob, step_payload blob, PRIMARY KEY (idx));" +
      "CREATE TABLE gen_metadata (idx integer, data blob, size integer, PRIMARY KEY (idx));",
  );
  const insertStep = db.prepare(
    "INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?,?,?,?,?)",
  );
  steps.forEach((s, i) =>
    insertStep.run(
      i,
      s.type,
      3,
      stepMeta(s.at),
      new TextEncoder().encode("PRIVATE-PROMPT-TEXT-MUST-NOT-LEAK"),
    ),
  );
  const insertGen = db.prepare(
    "INSERT INTO gen_metadata (idx, data, size) VALUES (?,?,?)",
  );
  generations.forEach((g, i) => insertGen.run(i, g, g.length));
  db.close();
}

async function fixture(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(path.join(tmpdir(), "antigravity-test-"));
  const previous = {
    home: process.env.ANTIGRAVITY_HOME,
    tz: process.env.USAGE_TIMEZONE,
  };
  process.env.ANTIGRAVITY_HOME = home;
  process.env.USAGE_TIMEZONE = "UTC";
  try {
    await run(home);
  } finally {
    for (const [name, value] of Object.entries({
      ANTIGRAVITY_HOME: previous.home,
      USAGE_TIMEZONE: previous.tz,
    }))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    await rm(home, { recursive: true, force: true });
  }
}
const DAY = Date.UTC(2026, 8, 1) / 1000; // 2026-09-01T00:00:00Z

test("protobuf reader decodes packed and unpacked fields and rejects truncation", () => {
  const blob = cat(v(1, 300), packed(2, [1, 2, 3]), v(2, 4), str(3, "hi"));
  const list = fields(blob);
  assert.equal(num(list, 1), 300);
  assert.deepEqual(repeated(list, 2), [1, 2, 3, 4]);
  assert.equal(num(list, 9), 0, "a missing field means zero");
  assert.equal(message(list, 1), null, "a varint is not a nested message");
  assert.equal(fields(blob.subarray(0, blob.length - 1)), null);
  assert.equal(fields(Uint8Array.from([0x80])), null);
});

test("Antigravity tokens, requests, sessions and cost reconcile to a hand-computed fixture", async () => {
  await fixture(async (home) => {
    const dir = path.join(home, "antigravity", "conversations");
    await mkdir(dir, { recursive: true });
    createConversation(
      path.join(dir, "a.db"),
      [
        { type: 14, at: DAY + 100 }, // human request
        { type: 15, at: DAY + 110 },
        { type: 132, at: DAY + 111 }, // tool result, ignored
        { type: 15, at: DAY + 120 },
        { type: 17, at: DAY + 130 }, // quota error step
      ],
      [
        generation({
          steps: [1],
          modelEnum: 1071,
          label: "gemini-3.6-flash",
          // prompt = 1000 + 9000, output 500 of which 200 thinking
          usage: { input: 1000, cache: 9000, output: 500, thinking: 200 },
        }),
        generation({
          steps: [3],
          modelEnum: 1132,
          label: "gemini-3-flash-a",
          usage: { input: 10, output: 5 },
          padding: 200_000,
        }),
        generation({
          steps: [4],
          modelEnum: 1071,
          error: "RESOURCE_EXHAUSTED (code 429)",
        }),
      ],
    );
    // A second conversation with no usage still counts as a session via its human prompt.
    createConversation(
      path.join(dir, "b.db"),
      [{ type: 14, at: DAY + 86_400 + 5 }],
      [],
    );
    const s = await collectAntigravityUsage();
    assert.equal(s.provider, "antigravity");
    assert.equal(s.totals.assistantRequests, 2, "failed attempts are not requests");
    assert.equal(s.totals.humanRequests, 2);
    assert.equal(s.totals.sessions, 2);
    assert.equal(s.totals.inputTokens, 10_000 + 10);
    assert.equal(s.totals.cachedInputTokens, 9_000);
    assert.equal(s.totals.outputTokens, 505);
    assert.equal(s.totals.reasoningTokens, 200);
    assert.equal(s.totals.cacheWriteTokens, 0);
    assert.equal(s.totals.totalTokens, 10_010 + 505);
    assert.equal(s.totals.averageTokensPerSession, (10_010 + 505) / 2);
    // 3.6 Flash: 1000*0.75 + 9000*0.075 + 500*3.75 per million; thinking is not re-billed.
    const flash = s.models.find((m) => m.model === "gemini-3.6-flash")!;
    assert.ok(Math.abs(flash.costUsd - (750 + 675 + 1875) / 1e6) < 1e-12);
    // 3.5 Flash uses quoted rates: 10*1.5 + 5*9 per million.
    const high = s.models.find((m) => m.model === "gemini-3.5-flash-high")!;
    assert.equal(high.priced, true);
    assert.ok(Math.abs(high.costUsd - 60 / 1e6) < 1e-12);
    assert.equal(s.totals.unpricedTokens, 0);
    assert.equal(s.daily.map((d) => d.date).join(), "2026-09-01,2026-09-02");
    assert.equal(s.daily[1].humanRequests, 1);
    assert.match(s.coverage.warnings.join(" "), /1 model attempts failed/);
    // Every reported total reconciles with its chart aggregates and passes the upload validator.
    assert.doesNotThrow(() => validateSnapshot(JSON.parse(JSON.stringify(s))));
    // Prompt text from private step payloads never reaches the snapshot.
    assert.doesNotMatch(JSON.stringify(s), /PRIVATE-PROMPT/);
  });
});

test("Antigravity with no history is unavailable rather than zero usage", async () => {
  await fixture(async () => {
    const s = await collectAntigravityUsage();
    assert.equal(s.availability?.tokens, false);
    assert.equal(s.totals.totalTokens, 0);
    assert.doesNotThrow(() => validateSnapshot(JSON.parse(JSON.stringify(s))));
  });
});

test("Antigravity prices only published models and applies the 2027 Flash price change", () => {
  const tokens = {
    inputTokens: 1_000_000,
    cachedInputTokens: 500_000,
    cacheWriteTokens: 0,
    outputTokens: 100_000,
    reasoningTokens: 60_000,
    totalTokens: 1_100_000,
  };
  const before = new Date("2026-12-31T23:59:59Z");
  const after = new Date("2027-01-01T00:00:00Z");
  // 0.5M uncached*0.75 + 0.5M cached*0.075 + 0.1M output*3.75
  assert.ok(Math.abs(estimateAntigravityCost("gemini-3.8-flash", tokens, before)! - 0.7875) < 1e-9);
  assert.ok(Math.abs(estimateAntigravityCost("gemini-3.8-flash", tokens, after)! - 1.575) < 1e-9);
  // 3.5 and 3.7 Flash use fixed quoted rates that do not change on 2027-01-01.
  for (const when of [before, after]) {
    assert.ok(Math.abs(estimateAntigravityCost("gemini-3.7-flash", tokens, when)! - 0.7875) < 1e-9);
    assert.ok(Math.abs(estimateAntigravityCost("gemini-3.5-flash-high", tokens, when)! - 1.725) < 1e-9);
    assert.equal(
      estimateAntigravityCost("gemini-3.5-flash-medium", tokens, when),
      estimateAntigravityCost("gemini-3.5-flash-high", tokens, when),
    );
  }
  assert.equal(estimateAntigravityCost("antigravity-model-9999", tokens), null);
  assert.notEqual(estimateAntigravityCost("claude-opus-4-6", tokens), null);
  assert.equal(antigravityModelName(undefined, 1318), "gemini-3.8-flash");
  assert.equal(antigravityModelName("gemini-3-flash-a", 0), "gemini-3.5-flash-high");
  assert.equal(antigravityModelName(undefined, 424242), "antigravity-model-424242");
  assert.equal(antigravityModelName(undefined, 0), "unknown");
});

const oneCall = (at: number, usage: Usage, enumId = 1071) => ({
  steps: [{ type: 14, at }, { type: 15, at: at + 1 }],
  generations: [
    generation({ steps: [1], modelEnum: enumId, label: "gemini-3.6-flash", usage }),
  ],
});

test("collecting leaves the Antigravity folder untouched (no sidecar files)", async () => {
  await fixture(async (home) => {
    const dir = path.join(home, "antigravity", "conversations");
    await mkdir(dir, { recursive: true });
    const c = oneCall(DAY, { input: 5, output: 3 });
    createConversation(path.join(dir, "a.db"), c.steps, c.generations);
    const before = (await readdir(dir)).sort();
    await collectAntigravityUsage();
    await collectAntigravityUsage();
    assert.deepEqual((await readdir(dir)).sort(), before);
  });
});

test("implausible token counts are skipped and flagged while neighbours are kept", async () => {
  await fixture(async (home) => {
    const dir = path.join(home, "antigravity", "conversations");
    await mkdir(dir, { recursive: true });
    createConversation(
      path.join(dir, "a.db"),
      [{ type: 14, at: DAY }, { type: 15, at: DAY + 1 }, { type: 15, at: DAY + 2 }],
      [
        generation({ steps: [1], modelEnum: 1071, usage: { input: 7, output: 2 ** 41 } }),
        generation({ steps: [2], modelEnum: 1071, usage: { input: 4, output: 1 } }),
      ],
    );
    const s = await collectAntigravityUsage();
    assert.equal(s.totals.assistantRequests, 1);
    assert.equal(s.totals.totalTokens, 5);
    assert.match(s.coverage.warnings.join(" "), /did not match the expected layout/);
    assert.doesNotThrow(() => validateSnapshot(JSON.parse(JSON.stringify(s))));
  });
  // A varint whose 10th byte overflows 64 bits is corrupt, not a huge number.
  assert.equal(fields(Uint8Array.from([0x08, ...Array(9).fill(0xff), 0x7f])), null);
});

test("a corrupt database is isolated, and both IDE and CLI roots are read", async () => {
  await fixture(async (home) => {
    const ide = path.join(home, "antigravity", "conversations"),
      cli = path.join(home, "antigravity-cli", "conversations");
    await mkdir(ide, { recursive: true });
    await mkdir(cli, { recursive: true });
    await writeFile(path.join(ide, "broken.db"), "this is not a database");
    const a = oneCall(DAY, { input: 10, output: 5 });
    createConversation(path.join(cli, "cli.db"), a.steps, a.generations);
    const b = oneCall(DAY + 60, { input: 20, output: 5 });
    createConversation(path.join(ide, "ide.db"), b.steps, b.generations);
    const s = await collectAntigravityUsage();
    assert.equal(s.totals.assistantRequests, 2);
    assert.equal(s.totals.totalTokens, 40);
    assert.equal(s.coverage.filesScanned, 2);
    assert.match(s.coverage.warnings.join(" "), /1 conversation databases could not be read/);
  });
});

test("a database that becomes unreadable keeps its last good reading", async () => {
  await fixture(async (home) => {
    const dir = path.join(home, "antigravity", "conversations");
    await mkdir(dir, { recursive: true });
    const c = oneCall(DAY, { input: 10, output: 5 });
    const file = path.join(dir, "a.db");
    createConversation(file, c.steps, c.generations);
    assert.equal((await collectAntigravityUsage()).totals.totalTokens, 15);
    await writeFile(file, "half-written garbage that changes size and mtime");
    const s = await collectAntigravityUsage();
    assert.equal(s.totals.totalTokens, 15, "a transient failure must not shrink the snapshot");
    assert.match(s.coverage.warnings.join(" "), /were busy; their previous readings were reused/);
  });
});

test("prompts in child conversations are disclosed rather than hidden", async () => {
  await fixture(async (home) => {
    const dir = path.join(home, "antigravity", "conversations");
    await mkdir(dir, { recursive: true });
    const c = oneCall(DAY, { input: 10, output: 5 });
    const file = path.join(dir, "child.db");
    createConversation(file, c.steps, c.generations);
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE parent_references (idx integer, data blob, PRIMARY KEY (idx));");
    db.prepare("INSERT INTO parent_references (idx, data) VALUES (0, ?)").run(Uint8Array.from([1]));
    db.close();
    const s = await collectAntigravityUsage();
    assert.equal(s.totals.humanRequests, 1);
    assert.match(s.coverage.warnings.join(" "), /1 user-input steps are in conversations that reference a parent/);
  });
});

test("a model with no known price stays unpriced and is counted as unpriced tokens", async () => {
  await fixture(async (home) => {
    const dir = path.join(home, "antigravity", "conversations");
    await mkdir(dir, { recursive: true });
    const c = oneCall(DAY, { input: 100, cache: 50, output: 20 }, 4242);
    createConversation(path.join(dir, "a.db"), c.steps, [
      generation({ steps: [1], modelEnum: 4242, usage: { input: 100, cache: 50, output: 20 } }),
    ]);
    const s = await collectAntigravityUsage();
    assert.equal(s.models[0].model, "antigravity-model-4242");
    assert.equal(s.models[0].priced, false);
    assert.equal(s.totals.costUsd, 0);
    assert.equal(s.totals.unpricedTokens, 170);
    assert.equal(s.availability?.cost, false);
  });
});
