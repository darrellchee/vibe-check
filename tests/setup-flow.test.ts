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
  assert.deepEqual(setupStep({ cloud: false, site: null, deployed: null }, { ...fresh, signedIn: true, hasData: true }), { step: 1, view: "deploy" });
  assert.deepEqual(setupStep({ cloud: false, site: "https://me.vercel.app", deployed: "https://me.vercel.app" }, fresh), { step: 3, view: "publish" });
  // Unlinked, but a site was deployed: reconnect rather than deploy a second copy.
  assert.deepEqual(setupStep({ cloud: false, site: null, deployed: "https://me.vercel.app" }, fresh), { step: 2, view: "reconnect" });
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
  const before = { VIBE_CHECK_MODE: env.VIBE_CHECK_MODE, SYNC_URL: env.SYNC_URL, HOME: env.HOME, DEPLOYED_SITE: env.DEPLOYED_SITE };
  const cwd = process.cwd();
  try {
    env.HOME = await mkdtemp(path.join(tmpdir(), "vibe-check-empty-home-")); // No installed collector here.
    process.chdir(env.HOME); // Nor any settings file.
    env.VIBE_CHECK_MODE = "local";
    delete env.SYNC_URL;
    delete env.DEPLOYED_SITE;
    assert.deepEqual(await setupState(), { cloud: false, site: null, deployed: null });
    env.DEPLOYED_SITE = "https://me.vercel.app"; // Unlinked, but the site is still known.
    assert.deepEqual(await setupState(), { cloud: false, site: null, deployed: "https://me.vercel.app" });
    env.SYNC_URL = "https://me.vercel.app";
    assert.deepEqual(await setupState(), { cloud: false, site: "https://me.vercel.app", deployed: "https://me.vercel.app" });
  } finally {
    process.chdir(cwd);
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete env[k]; else env[k] = v;
  }
});

test("a local copy shows the deployed-site page (or setup) first, then the dashboard once chosen", async () => {
  const { gateView } = await import("../lib/setup-flow");
  assert.equal(gateView({ cloud: true, linked: false, chosen: false }), "dashboard");
  assert.equal(gateView({ cloud: false, linked: true, chosen: false }), "deployed-only");
  assert.equal(gateView({ cloud: false, linked: false, chosen: false }), "setup");
  assert.equal(gateView({ cloud: false, linked: true, chosen: true }), "dashboard");
  assert.equal(gateView({ cloud: false, linked: false, chosen: true }), "dashboard");
});

test("tabs only hand over a deployed site that is a vercel.app setup page", async () => {
  const { readDeployMessage } = await import("../lib/setup-flow");
  assert.deepEqual(readDeployMessage({ type: "deployed", target: "https://me.vercel.app/setup" }),
    { type: "deployed", target: "https://me.vercel.app/setup" });
  assert.deepEqual(readDeployMessage({ type: "taken" }), { type: "taken" });
  for (const bad of [null, "deployed", 42, {}, { type: "deployed" }, { type: "deployed", target: "https://evil.com/setup" },
    { type: "deployed", target: "javascript:alert(1)" }, { type: "other", target: "https://me.vercel.app" }])
    assert.equal(readDeployMessage(bad), null, JSON.stringify(bad));
});

