import test from "node:test";
import assert from "node:assert/strict";
import { cardAnimations, cardKinds, cardOptions, renderCard, widgetEmbed, type CardKind } from "../lib/profile-card";
import { sanitizeBlocks, serializeReadme, type ReadmeBlock } from "../lib/readme-doc";
import { combineSnapshots } from "../lib/overview";
import { sampleSnapshot } from "../lib/sample-snapshot";

const now = Date.parse("2026-11-01T12:00:00Z");
const snapshot = sampleSnapshot("codex", now);
const all = combineSnapshots([sampleSnapshot("codex", now), sampleSnapshot("claude", now)])!;
const draw = (kind: CardKind, animation?: (typeof cardAnimations)[number], border?: "none") =>
  kind === "harnesses"
    ? renderCard(all, "all", "dark", { kind, animation, border })
    : renderCard(snapshot, "codex", "dark", { kind, animation, border });

test("there are four animations, one of them none", () => {
  assert.deepEqual(cardAnimations, ["none", "fade", "shimmer", "pulse"]);
});

test("no animation draws the card exactly as before", () => {
  for (const kind of cardKinds) {
    const still = draw(kind);
    assert.equal(draw(kind, "none"), still, kind);
    assert.ok(!still.includes("<style>") && !still.includes("vc-"), kind);
  }
});

test("every card kind animates with CSS only, and honours reduced motion", () => {
  for (const kind of cardKinds) for (const animation of ["fade", "shimmer", "pulse"] as const) {
    const svg = draw(kind, animation);
    assert.ok(svg.includes("<style>") && svg.includes("@keyframes"), `${kind} ${animation}`);
    assert.ok(svg.includes("prefers-reduced-motion"), `${kind} ${animation}`);
    // <img> runs no scripts, so nothing may depend on them.
    assert.ok(!/<script|on\w+=/i.test(svg), `${kind} ${animation}`);
    assert.ok(svg.endsWith("</svg>") && svg.split("<svg").length === 2, `${kind} ${animation}`);
  }
});

test("each animation draws what it needs", () => {
  assert.ok(draw("usage", "fade").includes('class="vc-body"'));
  assert.ok(draw("usage", "shimmer").includes('class="vc-shine"'));
  assert.ok(draw("usage", "shimmer").includes('clip-path="url(#vc-shine-clip)"'));
  assert.ok(draw("usage", "pulse").includes('class="vc-frame"'));
  // A borderless card shimmers only what is drawn: the band is masked to a white copy of the content,
  // never clipped to (and so lighting up) the whole card rectangle.
  for (const kind of cardKinds) {
    const clearShine = draw(kind, "shimmer", "none");
    assert.ok(clearShine.includes('mask="url(#vc-shine-mask)"') && !clearShine.includes("vc-shine-clip"), kind);
    assert.equal((clearShine.match(/id="vc-m-/g) ?? []).length, (clearShine.match(/id="(?!vc-|title|desc)/g) ?? []).length, kind); // the copy's ids never clash
  }
  assert.ok(draw("usage", "shimmer").includes('clip-path="url(#vc-shine-clip)"'));
  // A borderless card has no outline to glow, but its title still breathes.
  const clear = draw("calendar", "pulse", "none");
  assert.ok(!clear.includes('class="vc-frame"') && clear.includes("vc-breathe"));
});

test("animation travels through the card URL and is checked", () => {
  const embed = widgetEmbed("https://vibe-check.example", "codex", "dark", { kind: "usage", metrics: ["tokens"], animation: "shimmer" });
  const url = new URL(embed.image);
  assert.equal(url.searchParams.get("animation"), "shimmer");
  assert.equal(cardOptions(url).animation, "shimmer");
  // The default stays out of the URL, so existing embeds keep their links.
  const plain = new URL(widgetEmbed("https://vibe-check.example", "codex", "dark", { kind: "usage", metrics: ["tokens"], animation: "none" }).image);
  assert.equal(plain.searchParams.has("animation"), false);
  assert.equal(cardOptions(plain).animation, "none");
  assert.throws(() => cardOptions(new URL("https://x.example/api/card?animation=spin")));
  assert.throws(() => cardOptions(new URL("https://x.example/api/card?animation=fade&animation=pulse")));
});

test("saved READMEs keep a card's animation and drop unknown ones", () => {
  const clean = sanitizeBlocks([
    { id: "1", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], animation: "pulse" },
    { id: "2", type: "calendar", provider: "codex", theme: "dark", animation: "none" },
    { id: "3", type: "trend", provider: "codex", theme: "dark", animation: "<script>" },
  ]);
  assert.deepEqual(clean.map((b) => ("animation" in b ? b.animation : undefined)), ["pulse", undefined, undefined]);
  // The published Markdown points both themed images at the animated card.
  const { markdown } = serializeReadme(clean.slice(0, 1) as ReadmeBlock[], "https://vibe-check.example");
  assert.match(markdown, /animation=pulse/);
});
