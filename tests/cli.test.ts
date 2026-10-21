import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
test("collector and sync CLIs isolate all four products, continue after a failed upload and stop watch cleanly", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atlas-cli-"));
  const token = "synthetic-cli-secret-at-least-32-characters";
  const received: string[] = [];
  let rejectCodex = false,
    watchChild: ReturnType<typeof spawn> | undefined;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    let body = "";
    for await (const chunk of request) body += chunk;
    const snapshot = JSON.parse(body),
      provider = new URL(request.url!, "http://localhost").searchParams.get(
        "provider",
      );
    assert.equal(snapshot.provider || "codex", provider);
    assert.equal(body.includes("private prompt"), false);
    received.push(provider!);
    response.writeHead(rejectCodex && provider === "codex" ? 503 : 200);
    response.end("{}");
    if (watchChild && received.length === 3)
      setTimeout(() => watchChild?.kill("SIGTERM"), 25);
  });
  const run = (
    script: string,
    args: string[],
    extra: Record<string, string | undefined> = {},
    watch = false,
  ) =>
    new Promise<{ code: number | null; logs: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(root, "node_modules/tsx/dist/cli.mjs"),
          path.join(root, "scripts", script),
          ...args,
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            CODEX_HOME: path.join(dir, "codex"),
            CLAUDE_HOME: path.join(dir, "claude"),
            CURSOR_USAGE_CSV: path.join(dir, "cursor-imports", "usage.csv"),
            CURSOR_USAGE_DIR: path.join(dir, "cursor-imports"),
            CURSOR_DB_PATH: path.join(dir, "missing-cursor-fixture.vscdb"),
            // Never read the developer's real Antigravity history in tests.
            ANTIGRAVITY_HOME: path.join(dir, "antigravity-home"),
            SYNC_TOKEN: token,
            ...extra,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      if (watch) watchChild = child;
      let logs = "";
      child.stdout!.on("data", (d) => (logs += d));
      child.stderr!.on("data", (d) => (logs += d));
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("CLI smoke timed out."));
      }, 10_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        assert.equal(logs.includes(token), false);
        resolve({ code, logs });
      });
    });
  try {
    await mkdir(path.join(dir, "codex/sessions"), { recursive: true });
    await mkdir(path.join(dir, "claude/projects/p"), { recursive: true });
    const timestamp = "2026-10-18T12:00:00.000Z";
    await writeFile(
      path.join(dir, "codex/sessions/a.jsonl"),
      JSON.stringify({
        type: "token_usage_record",
        timestamp,
        payload: {
          thread_id: "fixture",
          response_id: "fixture",
          model: "gpt-6.1-sol",
          usage: { input_tokens: 12, cached_input_tokens: 6, output_tokens: 3 },
        },
      }) + "\n",
    );
    await writeFile(
      path.join(dir, "claude/projects/p/a.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp,
        sessionId: "fixture",
        message: {
          id: "fixture",
          model: "claude-opus-5",
          content: "private prompt",
          usage: {
            input_tokens: 3,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 2,
            output_tokens: 5,
          },
        },
      }) + "\n",
    );
    await mkdir(path.join(dir, "cursor-imports"), { recursive: true });
    await writeFile(path.join(dir, "cursor-imports", "usage.csv"), [
      'Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost',
      `${timestamp},Included,Auto,No,3,4,5,6,18,0`,
    ].join('\n'));
    const collected = await run("collect.ts", ["--provider", "all"]);
    assert.equal(collected.code, 0, collected.logs);
    const codex = JSON.parse(
        await readFile(path.join(dir, "data/snapshot.json"), "utf8"),
      ),
      claude = JSON.parse(
        await readFile(path.join(dir, "data/claude-snapshot.json"), "utf8"),
      );
    assert.equal(codex.totals.totalTokens, 15);
    assert.equal(claude.totals.totalTokens, 20);
    assert.equal(claude.provider, "claude");
    const cursor = JSON.parse(await readFile(path.join(dir, "data/cursor-snapshot.json"), "utf8"));
    assert.equal(cursor.provider, "cursor");
    assert.equal(cursor.totals.totalTokens, 18);
    assert.equal(cursor.availability.tokens, true);
    assert.equal(cursor.availability.sessions, false);
    assert.equal(cursor.availability.humanRequests, false);
    assert.equal((await stat(path.join(dir, "data/cursor-snapshot.json"))).mode & 0o777, 0o600);
    assert.equal(
      (await stat(path.join(dir, "data/claude-snapshot.json"))).mode & 0o777,
      0o600,
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const env = { SYNC_URL: `http://127.0.0.1:${address.port}` };
    const synced = await run("sync.ts", ["--provider", "all"], env);
    assert.equal(synced.code, 0);
    assert.deepEqual(received.splice(0), ["codex", "claude", "cursor", "antigravity"]);
    rejectCodex = true;
    const partial = await run("sync.ts", ["--provider", "all"], env);
    assert.equal(partial.code, 1);
    assert.deepEqual(received.splice(0), ["codex", "claude", "cursor", "antigravity"]);
    assert.match(partial.logs, /Sync failed for codex/);
    assert.match(partial.logs, /Synced claude/);
    assert.match(partial.logs, /Synced cursor/);
    rejectCodex = false;
    const watched = await run(
      "sync.ts",
      ["--provider", "all", "--watch"],
      env,
      true,
    );
    assert.equal(watched.code, 0);
    assert.deepEqual(received, ["codex", "claude", "cursor", "antigravity"]);
  } finally {
    watchChild?.kill("SIGTERM");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
