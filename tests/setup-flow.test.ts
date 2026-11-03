import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deployRedirectTarget, linkedSite, setupStep } from "../lib/setup-flow";
import { setupState } from "../lib/instance";
import type { SetupState } from "../lib/instance";

const ready = (claimed: boolean): SetupState => ({ cloud: true, storage: "ok", claimed, managedByEnv: false });
const fresh = { signedIn: false, hasData: false, connecting: false };

test("the wizard shows the step that matches what is already done", () => {
  assert.deepEqual(setupStep({ cloud: false, site: null }, { ...fresh, signedIn: true, hasData: true }), { step: 1, view: "deploy" });
  assert.deepEqual(setupStep({ cloud: false, site: "https://me.vercel.app" }, fresh), { step: 3, view: "publish" });
  assert.deepEqual(setupStep({ cloud: true, storage: "missing" }, fresh), { step: 1, view: "storage" });
  assert.deepEqual(setupStep({ cloud: true, storage: "error" }, fresh), { step: 1, view: "storage" });
  assert.deepEqual(setupStep(ready(false), fresh), { step: 2, view: "connect" });
  assert.deepEqual(setupStep(ready(true), fresh), { step: 2, view: "sign-in" });
  assert.deepEqual(setupStep(ready(true), { ...fresh, hasData: true }), { step: 2, view: "sign-in" });
  assert.deepEqual(setupStep(ready(true), { ...fresh, signedIn: true }), { step: 2, view: "connect" });
  assert.deepEqual(setupStep(ready(true), { ...fresh, signedIn: true, hasData: true }), { step: 3, view: "publish" });
  // "Connect another computer" from step 3.
  assert.deepEqual(setupStep(ready(true), { signedIn: true, hasData: true, connecting: true }), { step: 2, view: "connect" });
});

test("returning from Vercel only forwards to a vercel.app site's setup page", () => {
  assert.equal(deployRedirectTarget("vibe-check-abc.vercel.app"), "https://vibe-check-abc.vercel.app/setup");
  assert.equal(deployRedirectTarget("https://Vibe-Check.vercel.app/"), "https://vibe-check.vercel.app/setup");
  assert.equal(deployRedirectTarget("https://a.b.vercel.app/some/path?x=1"), "https://a.b.vercel.app/setup");
  for (const bad of [null, undefined, "", "   ", "evil.com", "vercel.app", "x.vercel.app.evil.com", "x.vercel.app@evil.com",
    "http://x.vercel.app", "https://user:pw@x.vercel.app", "https://x.vercel.app:8443", "javascript:alert(1)", "//evil.com", "x".repeat(400)])
    assert.equal(deployRedirectTarget(bad), null, String(bad));
});

test("a local copy counts as linked only once SYNC_URL names a public HTTPS site", () => {
  assert.equal(linkedSite("https://me.vercel.app"), "https://me.vercel.app");
  assert.equal(linkedSite(" https://stats.example.com/ "), "https://stats.example.com");
  for (const bad of [undefined, "", "not a url", "http://127.0.0.1:3000", "http://me.vercel.app", "https://user:pw@me.vercel.app"])
    assert.equal(linkedSite(bad), null, String(bad));
});

test("the setup status reports the linked site from SYNC_URL on a local copy", async () => {
  const env: Record<string, string | undefined> = process.env;
  const before = { ATLAS_MODE: env.ATLAS_MODE, SYNC_URL: env.SYNC_URL, HOME: env.HOME };
  try {
    env.HOME = await mkdtemp(path.join(tmpdir(), "atlas-empty-home-")); // No installed collector here.
    env.ATLAS_MODE = "local";
    delete env.SYNC_URL;
    assert.deepEqual(await setupState(), { cloud: false, site: null });
    env.SYNC_URL = "https://me.vercel.app";
    assert.deepEqual(await setupState(), { cloud: false, site: "https://me.vercel.app" });
  } finally {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete env[k]; else env[k] = v;
  }
});
