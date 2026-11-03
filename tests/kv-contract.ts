import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { KeyValueStore } from "../lib/kv";

// What every storage backend must guarantee. The access rules depend on these: one claim wins,
// a connect code is redeemed once, an expired code is dead, and old uploads never replace new ones.
// `wait` lets a test advance a fake clock instead of sleeping.
export async function checkStoreContract(store: KeyValueStore, wait: (ms: number) => Promise<void>) {
  const id = randomUUID();
  const key = (name: string) => `contract:${id}:${name}`;

  assert.equal(await store.get(key("claim")), null);
  const claims = await Promise.all([store.setIfAbsent(key("claim"), "one"), store.setIfAbsent(key("claim"), "two")]);
  assert.deepEqual([...claims].sort(), [false, true], "exactly one concurrent write-if-absent wins");
  assert.equal(await store.get(key("claim")), claims[0] ? "one" : "two");
  assert.equal(await store.setIfAbsent(key("claim"), "three"), false);

  assert.equal(await store.setIfAbsent(key("code"), "1", 60), true);
  const takes = await Promise.all([store.take(key("code")), store.take(key("code"))]);
  assert.deepEqual(takes.filter((v) => v !== null), ["1"], "a value is taken exactly once");
  assert.equal(await store.get(key("code")), null);
  assert.equal(await store.take(key("missing")), null);

  assert.equal(await store.setIfAbsent(key("short"), "1", 1), true);
  assert.equal(await store.get(key("short")), "1");
  await wait(1_500);
  assert.equal(await store.get(key("short")), null, "expired values read as absent");
  assert.equal(await store.take(key("short")), null, "expired values cannot be taken");
  assert.equal(await store.setIfAbsent(key("short"), "2", 1), true);
  await wait(1_500);
  assert.equal(await store.setIfAbsent(key("short"), "3", 60), true, "an expired key can be written again");
  assert.equal(await store.get(key("short")), "3");

  assert.equal(await store.hasMember(key("set"), "a"), false);
  await store.addMember(key("set"), "a");
  await store.addMember(key("set"), "a");
  assert.equal(await store.hasMember(key("set"), "a"), true);
  assert.equal(await store.hasMember(key("set"), "b"), false);
  assert.equal(await store.hasMember(key("other-set"), "a"), false);

  const snapshot = (at: string) => JSON.stringify({ generatedAt: at, marker: at });
  const [t1, t2, t3] = ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.001Z"];
  assert.equal(await store.putIfNewer(key("snapshot"), t2, snapshot(t2)), true);
  assert.equal(await store.putIfNewer(key("snapshot"), t1, snapshot(t1)), false, "older uploads are refused");
  assert.equal(await store.putIfNewer(key("snapshot"), t2, snapshot(t2)), false, "equal uploads are refused");
  assert.equal(await store.putIfNewer(key("snapshot"), t3, snapshot(t3)), true);
  assert.equal(JSON.parse((await store.get(key("snapshot")))!).marker, t3);
}
