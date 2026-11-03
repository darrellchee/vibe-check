import test from "node:test";
import assert from "node:assert/strict";
import { deployRedirectTarget, setupStep } from "../lib/setup-flow";
import type { SetupState } from "../lib/instance";

const ready = (claimed: boolean): SetupState => ({ cloud: true, storage: "ok", claimed, managedByEnv: false });
const fresh = { signedIn: false, hasData: false, connecting: false };

test("the wizard shows the step that matches what is already done", () => {
  assert.deepEqual(setupStep({ cloud: false }, { ...fresh, signedIn: true, hasData: true }), { step: 1, view: "deploy" });
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
