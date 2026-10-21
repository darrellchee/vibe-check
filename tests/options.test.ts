import test from "node:test";
import assert from "node:assert/strict";
import { collectionOptions } from "../scripts/options";

test("CLI defaults preserve Codex and supports explicit provider choices", () => {
  assert.deepEqual(collectionOptions([]), {
    providers: ["codex"],
    watch: false,
  });
  assert.deepEqual(collectionOptions(["--provider", "claude"]), {
    providers: ["claude"],
    watch: false,
  });
  assert.deepEqual(collectionOptions(["--provider", "cursor"]), {
    providers: ["cursor"],
    watch: false,
  });
  assert.deepEqual(collectionOptions(["--provider=codex"]), {
    providers: ["codex"],
    watch: false,
  });
  assert.deepEqual(collectionOptions(["--provider=all"]), {
    providers: ["codex", "claude", "cursor", "antigravity"],
    watch: false,
  });
  assert.deepEqual(collectionOptions(["--watch", "--provider", "all"], true), {
    providers: ["codex", "claude", "cursor", "antigravity"],
    watch: true,
  });
});

test("CLI rejects unknown, repeated, missing and unsupported watch arguments", () => {
  for (const args of [
    ["--provider"],
    ["--provider="],
    ["--provider", "other"],
    ["--provider", "CLAUDE"],
    ["--provider=claude", "--provider=codex"],
    ["--watch"],
    ["--token=private-fixture"],
    ["--provider", "all", "unexpected"],
  ])
    assert.throws(() => collectionOptions(args));
  assert.throws(() => collectionOptions(["--watch", "--watch"], true));
});
