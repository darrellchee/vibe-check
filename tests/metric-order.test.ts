import test from "node:test";
import assert from "node:assert/strict";
import { cardOptions, renderCard, widgetEmbed, type CardMetric } from "../lib/profile-card";
import { moveMetric, sanitizeBlocks, serializeReadme, toggleMetric } from "../lib/readme-doc";
import { sampleSnapshot } from "../lib/sample-snapshot";

test("metrics move to any position and keep the rest in order", () => {
  const three: CardMetric[] = ["tokens", "sessions", "cost"];
  assert.deepEqual(moveMetric(three, 0, 2), ["sessions", "cost", "tokens"]);
  assert.deepEqual(moveMetric(three, 2, 0), ["cost", "tokens", "sessions"]);
  assert.deepEqual(moveMetric(three, 1, 0), ["sessions", "tokens", "cost"]);
  // Out-of-range moves stop at the ends; a no-op returns the same list so callers can skip a redraw.
  assert.equal(moveMetric(three, 0, -1), three);
  assert.deepEqual(moveMetric(three, 1, 9), ["tokens", "cost", "sessions"]);
  assert.equal(moveMetric(three, 5, 0), three);
});

test("turning a metric on adds it at the end; turning one off keeps the order", () => {
  assert.deepEqual(toggleMetric(["cost", "tokens"], "sessions"), ["cost", "tokens", "sessions"]);
  assert.deepEqual(toggleMetric(["cost", "tokens", "sessions"], "tokens"), ["cost", "sessions"]);
});

test("the chosen order survives saving, the published link and drawing", () => {
  const [card] = sanitizeBlocks([{ id: "1", type: "usage", provider: "codex", theme: "dark", metrics: ["cost", "tokens", "cost", "nope", "sessions", "requests"] }]);
  // Duplicates and unknown names are dropped, the order is kept, and at most three remain.
  assert.deepEqual("metrics" in card ? card.metrics : [], ["cost", "tokens", "sessions"]);
  assert.match(serializeReadme([card], "https://vibe-check.example").markdown, /metrics=cost%2Ctokens%2Csessions|metrics=cost,tokens,sessions/);
  const url = new URL(widgetEmbed("https://vibe-check.example", "codex", "dark", { kind: "usage", metrics: ["sessions", "tokens"] }).image);
  assert.deepEqual(cardOptions(url).metrics, ["sessions", "tokens"]);
  // The card draws them left to right in that order, and Spotlight makes the first one the big number.
  const snapshot = sampleSnapshot("codex", Date.parse("2026-11-01T12:00:00Z"));
  for (const style of ["classic", "compact", "tiles", "list"] as const) {
    const svg = renderCard(snapshot, "codex", "dark", { kind: "usage", style, metrics: ["cost", "sessions", "tokens"] });
    const at = (label: string) => svg.indexOf(label);
    assert.ok(at("ESTIMATED COST") < at("SESSIONS") && at("SESSIONS") < at("RECORDED TOKENS"), style);
  }
  const spot = renderCard(snapshot, "codex", "dark", { kind: "usage", style: "spotlight", metrics: ["sessions", "tokens"] });
  assert.match(spot, /font-size="54"[^>]*>[\d.,KMB]+<\/text><text[^>]*>SESSIONS</);
});

test("the editor gets a box for every figure, in metric order, inside the card, without overlaps", async () => {
  const { cardStyles, usageSlots } = await import("../lib/profile-card");
  const snapshot = sampleSnapshot("codex", Date.parse("2026-11-01T12:00:00Z"));
  for (const style of cardStyles) for (const metrics of [["cost", "sessions", "tokens"], ["sessions", "tokens"]] as CardMetric[][]) {
    const { width, height, slots } = usageSlots(snapshot, "codex", metrics, { style });
    assert.deepEqual(slots.map((s) => s.metric), metrics, style);
    for (const s of slots) assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.width <= width && s.y + s.height <= height && s.width > 20 && s.height > 20, `${style} ${s.metric}`);
    for (const a of slots) for (const b of slots) if (a !== b)
      assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 2 || b.y + b.height <= a.y + 2, `${style}: ${a.metric} overlaps ${b.metric}`);
  }
});

test("the All usage card takes all four metrics; a single harness's card stays at three", async () => {
  const { maxMetrics } = await import("../lib/profile-card");
  const four: CardMetric[] = ["tokens", "sessions", "requests", "cost"];
  assert.equal(maxMetrics("all"), 4);
  assert.equal(maxMetrics("codex"), 3);
  const allUrl = new URL(widgetEmbed("https://vibe-check.example", "all", "dark", { kind: "usage", metrics: four }).image);
  assert.deepEqual(cardOptions(allUrl).metrics, four);
  const codexUrl = new URL(widgetEmbed("https://vibe-check.example", "codex", "dark", { kind: "usage", metrics: four }).image);
  assert.throws(() => cardOptions(codexUrl));
  const saved = sanitizeBlocks([
    { id: "a", type: "usage", provider: "all", theme: "dark", metrics: ["cost", "requests", "sessions", "tokens"] },
    { id: "c", type: "usage", provider: "codex", theme: "dark", metrics: ["cost", "requests", "sessions", "tokens"] },
  ]);
  assert.deepEqual(saved.map((b) => ("metrics" in b ? b.metrics.length : 0)), [4, 3]);
});

test("Classic spreads its figures evenly and draws them bigger the fewer there are", async () => {
  const { usageSlots, cardStyles } = await import("../lib/profile-card");
  const snapshot = sampleSnapshot("codex", Date.parse("2026-11-01T12:00:00Z"));
  const sizes: number[] = [];
  for (const metrics of [["tokens", "sessions"], ["tokens", "sessions", "cost"], ["tokens", "sessions", "requests", "cost"]] as CardMetric[][]) {
    const svg = renderCard(snapshot, "all", "dark", { kind: "usage", metrics });
    const xs = [...svg.matchAll(/<text x="(\d+)" y="86"[^>]*font-size="(\d+)"/g)];
    assert.deepEqual(xs.map((m) => Number(m[1])), metrics.map((_, i) => Math.round(26 + (i * 508) / metrics.length)), metrics.join());
    sizes.push(Math.max(...xs.map((m) => Number(m[2]))));
    // Four figures fit every layout without their drag targets overlapping.
    if (metrics.length === 4) for (const style of cardStyles) {
      const { width, height, slots } = usageSlots(snapshot, "all", metrics, { style });
      for (const s of slots) assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.width <= width + 1 && s.y + s.height <= height, `${style} ${s.metric}`);
      for (const a of slots) for (const b of slots) if (a !== b)
        assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 2 || b.y + b.height <= a.y + 2, `${style}: ${a.metric} overlaps ${b.metric}`);
    }
  }
  assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2] && sizes[2] >= 30, sizes.join());
  assert.ok(sizes[0] > 36); // bigger than the old 36px
});
