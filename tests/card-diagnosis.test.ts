import test from "node:test";
import assert from "node:assert/strict";
import { cardFix, disabledReason, siteWideMessage } from "../lib/card-diagnosis";

test("setup status explains why a deployed site's cards are disabled", () => {
  assert.equal(disabledReason({ cloud: true, storage: "missing" }), "storage-missing");
  assert.equal(disabledReason({ cloud: true, storage: "error" }), "storage-error");
  assert.equal(disabledReason({ cloud: true, storage: "ok", claimed: false, managedByEnv: false }), "unclaimed");
  assert.equal(disabledReason({ cloud: true, storage: "ok", claimed: true, managedByEnv: true }), "env-managed");
  assert.equal(disabledReason({ cloud: true, storage: "ok", claimed: true, managedByEnv: false }), "flag");
});

test("unexpected setup status falls back to the general advice", () => {
  for (const status of [null, "nope", {}, { cloud: false, site: null }, { cloud: true, storage: "ok" }, { cloud: true, storage: "weird" }])
    assert.equal(disabledReason(status), "unknown");
  assert.match(cardFix("unknown"), /finished setup/);
});

test("site-wide causes get one notice; per-card causes name the card's fix", () => {
  assert.match(siteWideMessage("storage-missing") ?? "", /no storage connected/);
  assert.match(siteWideMessage("unclaimed") ?? "", /\/setup/);
  assert.equal(siteWideMessage("flag"), null);
  assert.equal(siteWideMessage("env-managed"), null);
  assert.match(cardFix("flag"), /PUBLIC_\*_WIDGET=false/);
  assert.match(cardFix("env-managed"), /PUBLIC_\*_WIDGET=true/);
});
