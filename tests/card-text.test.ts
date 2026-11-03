import test from "node:test";
import assert from "node:assert/strict";
import { cardKinds, cardOptions, cleanCardText, LABEL_MAX, renderCard, TITLE_MAX, widgetEmbed, type CardKind, type CardMetric } from "../lib/profile-card";
import { sanitizeBlocks, serializeReadme } from "../lib/readme-doc";
import { combineSnapshots } from "../lib/overview";
import { sampleSnapshot } from "../lib/sample-snapshot";

const now = Date.parse("2026-11-01T12:00:00Z");
const snapshot = sampleSnapshot("codex", now);
const all = combineSnapshots([sampleSnapshot("codex", now), sampleSnapshot("claude", now)])!;
const draw = (kind: CardKind, extra: object = {}) => kind === "harnesses"
  ? renderCard(all, "all", "dark", { kind, ...extra })
  : renderCard(snapshot, "codex", "dark", { kind, metrics: ["tokens", "sessions"], ...extra });

test("every card's heading can be renamed; the default is unchanged", () => {
  for (const kind of cardKinds) {
    assert.equal(draw(kind, { title: "" }), draw(kind), kind);
    const svg = draw(kind, { title: "Shipping with agents" });
    assert.match(svg, />Shipping with agents<\/text>/, kind);
    assert.doesNotMatch(svg, /(CODEX|MY TOTAL AI) USAGE<\/text>/, kind);
  }
});

test("owner text is cleaned, capped and escaped", () => {
  assert.equal(cleanCardText("  a\u0000b\n\tc  ", 20), "ab c");
  assert.equal(cleanCardText("x".repeat(99), TITLE_MAX).length, TITLE_MAX);
  assert.equal(Array.from(cleanCardText("😀".repeat(40), LABEL_MAX)).length, LABEL_MAX); // never splits a character
  const svg = draw("usage", { title: `<script>alert(1)</script>`, labels: { tokens: `"><img onerror=x>` } });
  assert.ok(!svg.includes("<script") && !svg.includes("<img"));
  assert.match(svg, /&lt;script&gt;/);
});

test("usage labels change only the line under a figure, never the figure", () => {
  const plain = draw("usage"), named = draw("usage", { labels: { tokens: "Tokens burned", sessions: "Chats" } });
  const figures = (svg: string) => [...svg.matchAll(/font-weight="600">([^<]+)<\/text>/g)].map((m) => m[1]).filter((t) => /\d/.test(t));
  assert.deepEqual(figures(named), figures(plain));
  assert.match(named, />Tokens burned<\/text>/);
  assert.match(named, />Chats<\/text>/);
  assert.doesNotMatch(named, />RECORDED TOKENS<\/text>/);
  // A long label in a narrow column gets smaller type instead of running into the next one.
  const four: CardMetric[] = ["tokens", "sessions", "requests", "cost"];
  const tight = renderCard(all, "all", "dark", { kind: "usage", metrics: four, labels: { tokens: "Tokens this whole yr" } });
  const size = Number(/font-size="(\d+)"[^>]*>Tokens this whole yr</.exec(tight)?.[1]);
  assert.ok(size < 9 && size >= 6, String(size));
});

test("title and labels travel in the card URL, are checked there, and survive saving", () => {
  const embed = widgetEmbed("https://vibe-check.example", "codex", "dark", { kind: "usage", metrics: ["tokens"], title: "My agents", labels: { tokens: "Tokens", sessions: "Not shown" } });
  const url = new URL(embed.image);
  assert.equal(url.searchParams.get("title"), "My agents");
  assert.equal(url.searchParams.get("label-tokens"), "Tokens");
  assert.equal(url.searchParams.has("label-sessions"), false); // only shown metrics' labels
  const options = cardOptions(url);
  assert.equal(options.title, "My agents");
  assert.deepEqual(options.labels, { tokens: "Tokens" });
  assert.throws(() => cardOptions(new URL("https://x.example/api/card?title=a&title=b")));
  assert.equal(cardOptions(new URL(`https://x.example/api/card?title=${"y".repeat(500)}`)).title?.length, TITLE_MAX);
  // Defaults stay out of the URL.
  assert.equal(new URL(widgetEmbed("https://vibe-check.example", "codex", "dark", { kind: "calendar" }).image).searchParams.has("title"), false);

  const saved = sanitizeBlocks([
    { id: "1", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], title: "  Mine  ", labels: { tokens: "Burned", bogus: "x", sessions: "" } },
    { id: "2", type: "trend", provider: "codex", theme: "dark", title: 42 },
  ]);
  assert.deepEqual(saved[0], { id: "1", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], labels: { tokens: "Burned" }, title: "Mine" });
  assert.equal("title" in saved[1], false);
  assert.match(serializeReadme(saved, "https://vibe-check.example").markdown, /title=Mine/);
});
