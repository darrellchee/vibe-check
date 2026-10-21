import test from "node:test";
import assert from "node:assert/strict";
import { collectorService } from "../scripts/collector-service-config";
import { mkdtemp, mkdir, cp, symlink, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const config = {
  root: '/work/Atlas & "profile"', home: "/home/developer", node: "/usr/local/bin/node",
  loader: "file:///work/node_modules/tsx/dist/loader.mjs", provider: "all",
};
test("macOS collector uses escaped absolute paths, restarts and contains no credentials", () => {
  const service = collectorService({ ...config, platform: "darwin" });
  assert.match(service.file, /Library\/LaunchAgents\/dev.codex-atlas.collector.plist$/);
  assert.match(service.content, /Atlas &amp; &quot;profile&quot;/);
  assert.match(service.content, /<key>KeepAlive<\/key><true\/>/);
  assert.match(service.content, /<string>--watch<\/string>/);
  assert.equal(service.content.includes("SYNC_TOKEN"), false);
  assert.equal(service.content.includes("UPSTASH"), false);
});
test("Linux collector quotes command paths and escapes systemd expansion", () => {
  const service = collectorService({ ...config, root: '/work/100% "stats" $USER', platform: "linux" });
  assert.match(service.file, /\.config\/systemd\/user\/dev.codex-atlas.collector.service$/);
  assert.match(service.content, /100%%/);
  assert.match(service.content, /\$\$USER/);
  assert.match(service.content, /Restart=always/);
  assert.match(service.content, /UMask=0077/);
  assert.match(service.content, /"--provider" "all" "--watch"/);
  assert.equal(service.content.includes("SYNC_TOKEN"), false);
});
test("service configs reject control characters and unknown providers", () => {
  assert.throws(() => collectorService({ ...config, platform: "linux", root: "/work\nExecStart=bad" }));
  assert.throws(() => collectorService({ ...config, platform: "darwin", provider: "unsupported" }));
});

test("installer installs, reinstalls and removes in an isolated home without embedding the secret", async () => {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const temp = await mkdtemp(path.join(tmpdir(), "atlas-service-"));
  const root = path.join(temp, "repo with spaces"), home = path.join(temp, "home"), bin = path.join(temp, "bin");
  const secret = "service-fixture-secret-12345678901234567890";
  try {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await mkdir(home);
    await mkdir(bin);
    for (const file of ["collector-service.ts", "collector-service-config.ts", "options.ts"])
      await cp(path.resolve("scripts", file), path.join(root, "scripts", file));
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    // Fake only the OS service-manager boundary. No real user service is changed.
    const command = path.join(bin, process.platform === "darwin" ? "launchctl" : "systemctl");
    await writeFile(command, `#!${process.execPath}\nconst fs = require('node:fs'); fs.appendFileSync(process.env.SERVICE_CALLS, JSON.stringify(process.argv.slice(2))+'\\n'); process.exit(0);\n`, { mode: 0o700 });
    const calls = path.join(temp, "calls.jsonl");
    const run = (...args: string[]) => spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), path.join(root, "scripts/collector-service.ts"), ...args], {
      cwd: root, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, SERVICE_CALLS: calls }, encoding: "utf8",
    });
    assert.equal(run("install").status, 1, "must reject missing credentials before service-manager calls");
    const envFile = path.join(root, ".env.local");
    await writeFile(envFile, `SYNC_URL=https://atlas.example\nSYNC_TOKEN=${secret}\n`);
    const installed = run("install", "--provider", "all");
    assert.equal(installed.status, 0, installed.stderr);
    const service = collectorService({ ...config, root, home, platform: process.platform });
    const content = await readFile(service.file, "utf8");
    assert.equal(content.includes(secret), false);
    assert.equal((await stat(envFile)).mode & 0o777, 0o600);
    assert.equal((await stat(service.file)).mode & 0o777, 0o600);
    if (process.platform === "darwin") {
      const parsed = spawnSync("plutil", ["-lint", service.file], { encoding: "utf8" });
      assert.equal(parsed.status, 0, parsed.stderr);
    }
    assert.equal(run("install", "--provider", "claude").status, 0);
    assert.match(await readFile(service.file, "utf8"), /claude/);
    assert.equal(run("status").status, 0);
    const managerCalls = await readFile(calls, "utf8");
    assert.equal(managerCalls.includes(secret), false);
    assert.match(managerCalls, process.platform === "darwin" ? /bootstrap/ : /enable/);
    assert.equal(run("uninstall").status, 0);
    await assert.rejects(stat(service.file), { code: "ENOENT" });
    assert.match(await readFile(envFile, "utf8"), /SYNC_TOKEN/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
