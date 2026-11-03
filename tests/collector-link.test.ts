import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectorService, serviceFile } from "../scripts/collector-service-config";
import { readLocalLink, serviceRoot, unlinkLocal, withoutLink } from "../lib/collector-link";
import { POST as unlink } from "../app/api/setup/unlink/route";

const SERVICE = { home: "/Users/me", node: "/usr/local/bin/node", loader: "file:///x/tsx.mjs", provider: "all" };

test("the linked checkout is read back from what the installer writes, on both platforms", () => {
  for (const platform of ["darwin", "linux"] as const) {
    for (const root of ["/Users/me/.vibe-check", "/home/me/odd \"dir\" & 100%"]) {
      const { content } = collectorService({ ...SERVICE, platform, root });
      assert.equal(serviceRoot(content), root, `${platform} ${root}`);
    }
  }
  assert.equal(serviceRoot("<key>WorkingDirectory</key><string>/tmp</string>"), null); // Not ours.
});

test("unlinking removes only the site and upload token from settings", () => {
  const before = "ATLAS_MODE=local\nSYNC_URL=https://me.vercel.app\nCURSOR_AUTO_SYNC=true\nexport SYNC_TOKEN=abc\n";
  assert.equal(withoutLink(before), "ATLAS_MODE=local\nCURSOR_AUTO_SYNC=true\n");
});

async function fakeComputer(site = "https://me.vercel.app") {
  const home = await mkdtemp(path.join(tmpdir(), "atlas-home-"));
  const root = path.join(home, ".vibe-check");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, ".env.local"), `ATLAS_MODE=local\nSYNC_URL=${site}\nSYNC_TOKEN=${"a".repeat(64)}\n`, { mode: 0o600 });
  const { content } = collectorService({ ...SERVICE, home, platform: "linux", root });
  const file = serviceFile("linux", home);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return { home, root, file, cwd: await mkdtemp(path.join(tmpdir(), "atlas-clone-")) };
}

test("a clone finds the site through the installed collector, and unlinking stops it", async () => {
  const pc = await fakeComputer();
  const where = { home: pc.home, platform: "linux" as const, env: {}, cwd: pc.cwd };
  assert.deepEqual(await readLocalLink(where), { site: "https://me.vercel.app", root: pc.root });

  const commands: string[] = [];
  await unlinkLocal({ ...where, run: async (command, args) => { commands.push([command, ...args].join(" ")); } });
  assert.deepEqual(commands, [
    "systemctl --user disable --now dev.codex-atlas.collector.service",
    "systemctl --user daemon-reload",
  ]);
  await assert.rejects(stat(pc.file)); // Service definition removed.
  assert.equal(await readFile(path.join(pc.root, ".env.local"), "utf8"), "ATLAS_MODE=local\n");
  assert.equal(await readLocalLink(where), null);
});

test("an http or missing site never counts as linked", async () => {
  const pc = await fakeComputer("http://127.0.0.1:3000");
  assert.equal(await readLocalLink({ home: pc.home, platform: "linux", env: {}, cwd: pc.cwd }), null);
  assert.equal(await readLocalLink({ home: pc.home, platform: "win32", env: {}, cwd: pc.cwd }), null);
  assert.deepEqual(await readLocalLink({ home: pc.home, platform: "win32", env: { SYNC_URL: "https://x.example" }, cwd: pc.cwd }),
    { site: "https://x.example", root: pc.cwd });
});

test("the unlink endpoint only answers same-site requests on this computer, never on a deployment", async () => {
  const env: Record<string, string | undefined> = process.env;
  const before = { ATLAS_MODE: env.ATLAS_MODE, HOME: env.HOME, SYNC_URL: env.SYNC_URL };
  const request = (host: string, origin?: string) => new Request(`http://${host}/api/setup/unlink`, {
    method: "POST", headers: { host, ...(origin ? { origin } : {}) },
  });
  try {
    env.HOME = await mkdtemp(path.join(tmpdir(), "atlas-empty-home-"));
    delete env.SYNC_URL;
    env.ATLAS_MODE = "cloud";
    assert.equal((await unlink(request("127.0.0.1:3100", "http://127.0.0.1:3100"))).status, 404);
    env.ATLAS_MODE = "local";
    assert.equal((await unlink(request("127.0.0.1:3100"))).status, 403); // No Origin.
    assert.equal((await unlink(request("127.0.0.1:3100", "https://evil.example"))).status, 403);
    assert.equal((await unlink(request("atlas.example", "http://atlas.example"))).status, 403); // Not loopback.
    const ok = await unlink(request("127.0.0.1:3100", "http://127.0.0.1:3100"));
    assert.equal(ok.status, 200); // Nothing linked here, so nothing to stop.
    assert.deepEqual(await ok.json(), { unlinked: true });
  } finally {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete env[k]; else env[k] = v;
  }
});
