import test from "node:test";
import assert from "node:assert/strict";
import { allCardStyles, cardKinds, cardOptions, cardSize, renderCard, stylesFor, widgetEmbed, type CardKind, type CardStyle } from "../lib/profile-card";
import { sanitizeBlocks } from "../lib/readme-doc";
import { combineSnapshots } from "../lib/overview";
import { sampleSnapshot } from "../lib/sample-snapshot";

const now = Date.parse("2026-11-01T12:00:00Z");
const snapshot = sampleSnapshot("claude", now);
const all = combineSnapshots([sampleSnapshot("codex", now), sampleSnapshot("claude", now), sampleSnapshot("cursor", now)])!;
const draw = (kind: CardKind, style: CardStyle, theme: "dark" | "light" = "dark", border?: "none") =>
  kind === "harnesses"
    ? renderCard(all, "all", theme, { kind, style, border })
    : renderCard(snapshot, "claude", theme, { kind, style, border, metrics: ["tokens", "sessions", "cost"] });

test("every card kind has two more layouts than before", () => {
  const before: Record<CardKind, number> = { usage: 3, calendar: 2, trend: 2, models: 2, ledger: 2, harnesses: 1 };
  for (const kind of cardKinds) {
    assert.equal(stylesFor(kind).length, before[kind] + 2, kind);
    assert.equal(stylesFor(kind)[0], "classic", kind);
  }
});

test("every layout draws a well-formed card at its advertised size, and no two layouts of a kind look alike", () => {
  for (const kind of cardKinds) {
    const drawn = new Map<string, CardStyle>();
    for (const style of stylesFor(kind)) for (const theme of ["dark", "light"] as const) for (const border of [undefined, "none"] as const) {
      const svg = draw(kind, style, theme, border);
      const size = cardSize(kind, style, kind === "harnesses" ? all : snapshot);
      assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"`), `${kind}/${style}`);
      assert.equal((svg.match(/<svg/g) || []).length, 1);
      assert.ok(!svg.includes("NaN") && !svg.includes("undefined") && !svg.includes("Infinity"), `${kind}/${style}`);
      if (theme === "dark" && !border) {
        // Compare the drawing with the title and description taken out, so only the picture counts.
        const picture = svg.replace(/<title[^]*?<\/desc>/, "");
        assert.ok(!drawn.has(picture), `${kind}/${style} draws the same as ${kind}/${drawn.get(picture)}`);
        drawn.set(picture, style);
      }
    }
  }
});

test("layouts are checked per kind in the card URL and survive saving", () => {
  const url = new URL(widgetEmbed("https://vibe-check.example", "claude", "dark", { kind: "models", style: "donut" }).image);
  assert.equal(url.searchParams.get("style"), "donut");
  assert.equal(cardOptions(url).style, "donut");
  assert.throws(() => cardOptions(new URL("https://x.example/api/card?kind=calendar&style=donut")));
  assert.throws(() => cardOptions(new URL("https://x.example/api/card?style=wobbly")));
  for (const kind of cardKinds) for (const style of stylesFor(kind))
    assert.equal(cardOptions(new URL(`https://x.example/api/card?kind=${kind}&style=${style}`)).style, style);
  assert.ok(allCardStyles.length >= 10);
  const saved = sanitizeBlocks([
    { id: "1", type: "trend", provider: "claude", theme: "dark", style: "spark" },
    { id: "2", type: "harnesses", provider: "all", theme: "dark", style: "stacked" },
    { id: "3", type: "usage", provider: "claude", theme: "dark", metrics: ["tokens"], style: "months" },
  ]);
  assert.deepEqual(saved.map((b) => ("style" in b ? b.style : undefined)), ["spark", "stacked", undefined]);
});

test("new layouts stay readable with no data", () => {
  const empty: typeof snapshot = { ...snapshot, daily: [], models: [], harnesses: [], availability: { ...snapshot.availability!, tokens: false, cost: false } };
  for (const kind of ["calendar", "trend", "models", "ledger"] as const) for (const style of stylesFor(kind).slice(2)) {
    const svg = renderCard(empty, "claude", "dark", { kind, style });
    assert.ok(!svg.includes("NaN") && !svg.includes("Infinity"), `${kind}/${style}`);
  }
  for (const style of ["tiles", "stacked"] as const)
    assert.match(renderCard({ ...all, harnesses: [] }, "all", "dark", { kind: "harnesses", style }), /No harness usage recorded/);
});
