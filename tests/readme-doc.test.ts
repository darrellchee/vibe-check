import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET as card } from "../app/api/card/route";
import { collectUsage } from "../lib/collector";
import { calendarEmbed, cardOptions, profileEmbed, renderActivityCalendar } from "../lib/profile-card";
import { parseInline, parseMarkdown, safeUrl } from "../lib/markdown";
import {
  insertBlock, MAX_BLOCKS, MAX_TEXT, moveBlock, PLACEHOLDER_ORIGIN, PRESETS, sanitizeBlocks, serializeReadme, stepBlock,
  type ReadmeBlock,
} from "../lib/readme-doc";

const text = (id: string, body = id): ReadmeBlock => ({ id, type: "text", text: body });
const ids = (blocks: ReadmeBlock[]) => blocks.map((b) => b.id).join("");

test("blocks insert and move by drop slot, the way the editor's drop indicator reports them", () => {
  const list = [text("a"), text("b"), text("c")];
  assert.equal(ids(insertBlock(list, 0, text("x"))), "xabc");
  assert.equal(ids(insertBlock(list, 3, text("x"))), "abcx");
  assert.equal(ids(insertBlock(list, 99, text("x"))), "abcx");
  // Slot 3 is "after c"; slot 0 is "before a"; dropping beside yourself changes nothing.
  assert.equal(ids(moveBlock(list, "a", 3)), "bca");
  assert.equal(ids(moveBlock(list, "c", 0)), "cab");
  assert.equal(moveBlock(list, "b", 1), list);
  assert.equal(moveBlock(list, "b", 2), list);
  assert.equal(moveBlock(list, "missing", 0), list);
  assert.equal(ids(stepBlock(list, "b", -1)), "bac");
  assert.equal(ids(stepBlock(list, "b", 1)), "acb");
  assert.equal(stepBlock(list, "a", -1), list);
  assert.equal(stepBlock(list, "c", 1), list);
});

test("every preset is a valid block and serializes to Markdown", () => {
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  const blocks = PRESETS.map((p, i) => ({ ...structuredClone(p.block), id: `p${i}` }) as ReadmeBlock);
  assert.equal(sanitizeBlocks(blocks).length, PRESETS.length);
  const { markdown, originError } = serializeReadme(blocks, "https://atlas.example");
  assert.equal(originError, "");
  assert.match(markdown, /!\[My recorded Claude Code usage\]\(https:\/\/atlas\.example\/api\/card\?provider=claude&theme=dark&metrics=tokens%2Csessions&accent=orange\)/);
  assert.match(markdown, /api\/card\?provider=cursor&theme=dark&metrics=tokens%2Csessions&style=spotlight&accent=blue\)/);
  assert.match(markdown, /!\[My recorded Cursor activity\]\(https:\/\/atlas\.example\/api\/card\?kind=calendar&provider=cursor&theme=dark&accent=blue\)/);
  // Codex is lime, the default accent, so its classic card keeps the original, parameter-free URL.
  assert.match(markdown, /usage\]\(https:\/\/atlas\.example\/api\/card\?provider=codex&theme=dark&metrics=tokens%2Csessions\)/);
  // Presets must survive a save and reload unchanged: nothing they set may be dropped by the sanitizer.
  assert.deepEqual(sanitizeBlocks(blocks), blocks);
});

test("README output joins blocks, and flags a missing public origin instead of emitting a broken image", () => {
  const blocks: ReadmeBlock[] = [text("h", "  ## Hi  "), { id: "u", type: "usage", provider: "codex", theme: "light", metrics: ["requests"] }, text("empty", "  ")];
  const ok = serializeReadme(blocks, "https://atlas.example");
  assert.equal(ok.markdown, "  ## Hi\n\n![My recorded Codex usage](https://atlas.example/api/card?provider=codex&theme=light&metrics=requests)\n");
  for (const origin of ["", "http://localhost:3000", "https://atlas.example/path"]) {
    const bad = serializeReadme(blocks, origin);
    assert.ok(bad.originError);
    assert.ok(bad.markdown.includes(PLACEHOLDER_ORIGIN));
  }
  // Text-only READMEs never need an origin.
  assert.deepEqual(serializeReadme([text("t", "Hello")], ""), { markdown: "Hello\n", originError: "", warnings: [] });
  assert.deepEqual(serializeReadme([], ""), { markdown: "", originError: "", warnings: [] });
});

test("stored drafts are rebuilt from known fields only", () => {
  const clean = sanitizeBlocks([
    { id: "1", type: "text", text: "hi", extra: "dropped" },
    { id: "1", type: "text", text: "duplicate id" },
    { id: "2", type: "usage", provider: "claude", theme: "light", metrics: ["requests", "bogus", "tokens"] },
    { id: "3", type: "usage", provider: "claude", theme: "light", metrics: [] },
    { id: "4", type: "usage", provider: "evil", theme: "light", metrics: ["tokens"] },
    { id: "5", type: "calendar", provider: "cursor", theme: "neon" },
    { id: "6", type: "calendar", provider: "cursor", theme: "dark" },
    { id: "7", type: "script", text: "x" }, null, 4, "x",
  ]);
  assert.deepEqual(clean, [
    { id: "1", type: "text", text: "hi" },
    { id: "2", type: "usage", provider: "claude", theme: "light", metrics: ["tokens", "requests"] },
    { id: "6", type: "calendar", provider: "cursor", theme: "dark" },
  ]);
  assert.deepEqual(sanitizeBlocks("nope"), []);
  assert.equal(sanitizeBlocks([{ id: "t", type: "text", text: "x".repeat(50_000) }])[0].type, "text");
  assert.equal((sanitizeBlocks([{ id: "t", type: "text", text: "x".repeat(50_000) }])[0] as { text: string }).text.length, 20_000);
});

test("Markdown preview parses a safe subset and drops dangerous URLs", () => {
  assert.equal(safeUrl("https://a.example/x", "link"), "https://a.example/x");
  assert.equal(safeUrl("mailto:me@a.example", "link"), "mailto:me@a.example");
  for (const url of ["javascript:alert(1)", "data:text/html,x", "/relative", "//evil.example", "vbscript:x"])
    assert.equal(safeUrl(url, "link"), null);
  assert.equal(safeUrl("http://a.example/i.png", "image"), null);

  assert.deepEqual(parseInline("a **b** `c` *d* snake_case_name"), [
    { t: "text", v: "a " }, { t: "strong", c: [{ t: "text", v: "b" }] }, { t: "text", v: " " },
    { t: "code", v: "c" }, { t: "text", v: " " }, { t: "em", c: [{ t: "text", v: "d" }] },
    { t: "text", v: " snake_case_name" },
  ]);
  // A badge is an image inside a link; a javascript: link stays visible as text.
  assert.deepEqual(parseInline("[![x](https://i.example/a.svg)](https://l.example)"), [
    { t: "link", href: "https://l.example/", c: [{ t: "image", src: "https://i.example/a.svg", alt: "x" }] },
  ]);
  assert.deepEqual(parseInline("[hi](javascript:alert(1))"), [{ t: "text", v: "[hi](javascript:alert(1))" }]);
  assert.deepEqual(parseInline("<img src=x onerror=alert(1)>"), [{ t: "text", v: "<img src=x onerror=alert(1)>" }]);

  const blocks = parseMarkdown("# Title\n\nline one\nline two\n\n- a\n- b\n\n1. x\n2. y\n\n> quoted\n\n---\n\n```\n# not a heading\n```\n");
  assert.deepEqual(blocks.map((b) => b.t), ["heading", "paragraph", "list", "list", "quote", "hr", "code"]);
  assert.deepEqual(blocks[1], { t: "paragraph", c: [{ t: "text", v: "line one line two" }] });
  assert.equal((blocks[3] as { ordered: boolean }).ordered, true);
  assert.equal((blocks[6] as { text: string }).text, "# not a heading");
  assert.deepEqual(parseMarkdown("   \n\n"), []);
});

test("activity calendar publishes levels, never exact days or source strings", async () => {
  assert.equal(cardOptions(new URL("https://atlas.example/api/card")).kind, "usage");
  assert.equal(cardOptions(new URL("https://atlas.example/api/card?kind=calendar")).kind, "calendar");
  for (const query of ["kind=evil", "kind=usage&kind=calendar", "kind="])
    assert.throws(() => cardOptions(new URL(`https://atlas.example/api/card?${query}`)));

  const snapshot = await collectUsage(path.join(tmpdir(), randomUUID()));
  snapshot.generatedAt = "2026-10-21T08:00:00.000Z"; // a Wednesday
  snapshot.coverage.warnings = ["<script>private-project-path</script>"];
  const day = (date: string, totalTokens: number, humanRequests = 1) =>
    ({ ...snapshot.daily[0], date, totalTokens, humanRequests, models: [{ model: "secret-model-name" }] }) as never;
  snapshot.daily = [day("2026-10-21", 4_000_000), day("2026-10-20", 1_000_000), day("2026-10-19", 2_000_000),
    day("2026-10-18", 3_000_000), day("2024-01-01", 999_000_000), day("<x>", 5)];
  const svg = renderActivityCalendar(snapshot, "codex", "dark");
  assert.match(svg, /^<svg[^>]*width="720"/);
  assert.match(svg, /CODEX ATLAS/);
  assert.match(svg, /10M tokens · 4 active days/);
  assert.equal((svg.match(/<rect /g) || []).length, 1 + (52 * 7 + 3 + 1) + 5);
  // 4 active days spread over 4 intensities: one cell per level, plus one legend swatch each.
  const swatches = (markup: string, fill: string) => (markup.match(new RegExp(`<rect [^>]*fill="${fill}"`, "g")) || []).length;
  for (const fill of ["#3b5a24", "#5d8f2e", "#8cc84b", "#b7ea76"]) assert.equal(swatches(svg, fill), 2, fill);
  for (const leaked of ["secret-model-name", "private-project-path", "<script>", "4000000", "999", "2026-10-20", "&lt;x&gt;"])
    assert.equal(svg.includes(leaked), false, leaked);
  assert.match(renderActivityCalendar(snapshot, "codex", "light"), /#fafbf7/);

  // Without token data it falls back to human requests, then to unavailable.
  snapshot.availability = { tokens: false, cost: false, sessions: false, humanRequests: true, assistantRequests: false, cacheBreakdown: false };
  assert.match(renderActivityCalendar(snapshot, "cursor", "dark"), /4 requests · 4 active days/);
  snapshot.availability.humanRequests = false;
  const none = renderActivityCalendar(snapshot, "cursor", "dark");
  assert.match(none, />Unavailable<\/text>/);
  for (const fill of ["#3b5a24", "#5d8f2e", "#8cc84b", "#b7ea76"]) assert.equal(swatches(none, fill), 1, fill);
});

test("card route serves the calendar only for a known kind and only when the provider's card is public", async () => {
  const settings = { ATLAS_MODE: "cloud", PUBLIC_WIDGET: "true", PUBLIC_CLAUDE_WIDGET: "false",
    UPSTASH_REDIS_REST_URL: "https://storage.example", UPSTASH_REDIS_REST_TOKEN: "private-redis-token",
    DASHBOARD_PASSWORD: "private-dashboard-password" };
  const before = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  const realFetch = globalThis.fetch;
  const snapshot = await collectUsage(path.join(tmpdir(), randomUUID()));
  let reads = 0;
  const request = (query = "") => new Request(`https://atlas.example/api/card${query}`);
  try {
    for (const [key, value] of Object.entries(settings)) process.env[key] = value;
    globalThis.fetch = async (_url, init) => {
      const command = JSON.parse(String(init?.body));
      if (String(command[1]).includes("instance")) return Response.json({ result: null });
      reads++;
      return Response.json({ result: JSON.stringify(snapshot) });
    };

    const calendar = await card(request("?kind=calendar"));
    assert.equal(calendar.status, 200);
    assert.match(calendar.headers.get("content-type")!, /image\/svg\+xml/);
    assert.match(calendar.headers.get("content-security-policy")!, /sandbox/);
    assert.equal(calendar.headers.get("x-content-type-options"), "nosniff");
    const calendarSvg = await calendar.text();
    assert.ok(calendarSvg.includes('<title id="title">Codex activity</title>'));
    assert.ok(calendarSvg.includes("Last 12 months"));

    for (const query of ["", "?kind=usage"]) {
      const usageResponse = await card(request(query));
      assert.equal(usageResponse.status, 200, query);
      const usageSvg = await usageResponse.text();
      assert.ok(usageSvg.includes('<title id="title">Codex usage</title>'), query);
      assert.equal(usageSvg.includes("Last 12 months"), false, query);
    }

    for (const query of ["?kind=bogus", "?kind=usage&kind=calendar", "?kind="]) {
      const bad = await card(request(query));
      assert.equal(bad.status, 400, query);
      assert.equal(bad.headers.get("cache-control"), "no-store", query);
    }

    // A provider whose card is disabled is hidden for every kind, and its snapshot is never read.
    reads = 0;
    const hidden = await card(request("?kind=calendar&provider=claude"));
    assert.equal(hidden.status, 404);
    assert.equal(hidden.headers.get("cache-control"), "no-store");
    assert.equal(reads, 0);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

// A snapshot with caller-chosen daily rows, for calendar edge cases.
async function calendarSnapshot(generatedAt: string, rows: [string, number, number?][]) {
  const snapshot = await collectUsage(path.join(tmpdir(), randomUUID()));
  snapshot.generatedAt = generatedAt;
  const base = snapshot.daily[0];
  snapshot.daily = rows.map(([date, totalTokens, humanRequests = 1]) => ({ ...base, date, totalTokens, humanRequests }) as never);
  return snapshot;
}
const rectCount = (svg: string) => (svg.match(/<rect /g) || []).length;
const monthLabels = (svg: string) => [...svg.matchAll(/<text x="(\d+)" y="56"[^>]*>(\w+)<\/text>/g)].map((m) => ({ x: Number(m[1]), name: m[2] }));

test("activity calendar ignores impossible dates and cannot be moved by a far-future row", async () => {
  const snapshot = await calendarSnapshot("2026-10-21T08:00:00.000Z", [
    ["2026-10-21", 5], ["2026-13-45", 900], ["2026-02-30", 900], ["2026-00-10", 900], ["2026-04-31", 900], ["9999-12-31", 900_000_000],
  ]);
  const svg = renderActivityCalendar(snapshot, "codex", "dark");
  assert.match(svg, /5 tokens · 1 active day</);
  assert.equal(rectCount(svg), 1 + (52 * 7 + 3 + 1) + 5); // the window still ends on 2026-10-21
  assert.equal(svg.includes("900M"), false);

  // One day beyond the generated date is allowed (timezones ahead of UTC); anything later is not.
  const ahead = await calendarSnapshot("2026-10-21T20:00:00.000Z", [["2026-10-22", 7], ["2026-10-23", 99], ["2027-01-01", 99]]);
  const aheadSvg = renderActivityCalendar(ahead, "codex", "dark");
  assert.match(aheadSvg, /7 tokens · 1 active day</);
  assert.equal(rectCount(aheadSvg), 1 + (52 * 7 + 4 + 1) + 5); // ends on Thursday 2026-10-22
});

test("activity calendar uses requests for Cursor, tokens for others, and pluralises active days", async () => {
  const snapshot = await calendarSnapshot("2026-10-21T08:00:00.000Z", [["2026-10-21", 1_000_000, 3], ["2026-10-20", 2_000_000, 4]]);
  snapshot.availability = { tokens: true, cost: true, sessions: true, humanRequests: true, assistantRequests: true, cacheBreakdown: true };
  // Cursor tokens only cover the synced range, so requests win even when tokens exist.
  assert.match(renderActivityCalendar(snapshot, "cursor", "dark"), /7 requests · 2 active days/);
  assert.match(renderActivityCalendar(snapshot, "codex", "dark"), /3M tokens · 2 active days/);
  assert.match(renderActivityCalendar(snapshot, "claude", "dark"), /3M tokens · 2 active days/);
  // Without human requests Cursor falls back to tokens; without tokens other providers fall back to requests.
  snapshot.availability.humanRequests = false;
  assert.match(renderActivityCalendar(snapshot, "cursor", "dark"), /3M tokens/);
  snapshot.availability = { tokens: false, cost: false, sessions: false, humanRequests: true, assistantRequests: false, cacheBreakdown: false };
  assert.match(renderActivityCalendar(snapshot, "codex", "dark"), /7 requests/);
  snapshot.availability.humanRequests = false;
  assert.match(renderActivityCalendar(snapshot, "cursor", "dark"), />Unavailable<\/text>/);

  const single = await calendarSnapshot("2026-10-21T08:00:00.000Z", [["2026-10-21", 5]]);
  const svg = renderActivityCalendar(single, "codex", "dark");
  assert.match(svg, /5 tokens · 1 active day</);
  assert.ok(svg.includes("across 1 active day in the last 12 months"));
  assert.equal(svg.includes("1 active days"), false);
  assert.match(renderActivityCalendar(await calendarSnapshot("2026-10-21T08:00:00.000Z", []), "codex", "dark"), /0 tokens · 0 active days</);
});

test("activity calendar never prints two month labels on top of each other", async () => {
  // 2026-10-21 starts its grid on Sunday 2025-10-19; November begins two columns later.
  const collision = await calendarSnapshot("2026-10-21T08:00:00.000Z", []);
  const labels = monthLabels(renderActivityCalendar(collision, "codex", "dark"));
  assert.equal(labels.some((l) => l.x === 26), false, "the partial first month is dropped");
  assert.equal(labels[0].name, "Nov");
  assert.equal(labels[0].x, 26 + 2 * 12);
  // And for every end date in a full year, labels stay at least three columns apart.
  for (let day = 0; day < 366; day++) {
    const generatedAt = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString();
    const svg = renderActivityCalendar(await calendarSnapshot(generatedAt, []), "codex", "dark");
    const xs = monthLabels(svg).map((l) => l.x);
    assert.ok(xs.length >= 11, generatedAt);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 36, `${generatedAt}: ${xs}`);
  }
  // A grid whose first month is not cut short keeps its label.
  const clean = monthLabels(renderActivityCalendar(await calendarSnapshot("2026-10-05T08:00:00.000Z", []), "codex", "dark"));
  assert.equal(clean[0].x, 26);
});

test("embed origins give friendly errors and reject hosts GitHub cannot reach", () => {
  const help = "Enter a full https:// address, for example https://your-instance.vercel.app";
  const embeds = [
    (origin: string) => calendarEmbed(origin, "codex", "dark"),
    (origin: string) => profileEmbed(origin, "codex", "dark", ["tokens"]),
  ];
  for (const embed of embeds) {
    for (const origin of ["atlas.example", "", "   ", "not a url", "//atlas.example"])
      assert.throws(() => embed(origin), { message: help }, JSON.stringify(origin));
    const priv = /private or local addresses/;
    for (const origin of [
      "https://localhost", "https://localhost:3000", "https://LOCALHOST.", "https://app.localhost", "https://printer.local",
      "https://api.internal", "https://intranet", "https://127.0.0.1", "https://127.255.0.9", "https://10.0.0.5", "https://172.16.0.1",
      "https://172.31.255.255", "https://192.168.1.10", "https://169.254.169.254", "https://100.64.0.1", "https://100.127.255.254",
      "https://0.0.0.0", "https://[::1]", "https://[2001:db8::1]", "https://[::ffff:127.0.0.1]:8443", "https://2130706433", "https://0x7f.1",
    ]) assert.throws(() => embed(origin), priv, origin);
    for (const origin of [
      "https://atlas.example", "https://atlas.example/", "https://my-app.vercel.app", "https://203.0.113.5", "https://172.15.0.1",
      "https://172.32.0.1", "https://100.63.0.1", "https://100.128.0.1", "https://192.169.0.1", "https://11.0.0.1", "https://atlas.example:8443",
    ]) assert.doesNotThrow(() => embed(origin), origin);
    // Existing rejections keep their wording.
    for (const origin of ["http://atlas.example", "https://u:p@atlas.example", "https://atlas.example/x", "https://atlas.example/?a=1", "https://atlas.example/#x", "javascript:alert(1)"])
      assert.throws(() => embed(origin), /public HTTPS dashboard origin/, origin);
  }
});

test("serializeReadme passes friendly origin errors through unchanged", () => {
  const widget: ReadmeBlock = { id: "c", type: "calendar", provider: "codex", theme: "dark" };
  assert.equal(serializeReadme([widget], "atlas.example").originError, "Enter a full https:// address, for example https://your-instance.vercel.app");
  assert.match(serializeReadme([widget], "https://192.168.0.2").originError, /GitHub cannot load images from private or local addresses/);
  assert.match(serializeReadme([widget], "https://localhost:3000").originError, /private or local/);
  assert.match(serializeReadme([widget], "http://atlas.example").originError, /public HTTPS dashboard origin/);
  assert.equal(serializeReadme([widget], "https://203.0.113.5").originError, "");
  assert.equal(serializeReadme([text("t", "hi")], "atlas.example").originError, "");
});

test("text blocks keep their indentation; only leading blank lines and trailing space are removed", () => {
  const code = "    indented code\n      deeper";
  assert.equal(serializeReadme([text("a", code)], "").markdown, `${code}\n`);
  assert.equal(serializeReadme([text("a", "\n \t\n\n  - item\n    - nested   \n\n  ")], "").markdown, "  - item\n    - nested\n");
  assert.equal(serializeReadme([text("a", "   \n\t"), text("b", "x")], "").markdown, "x\n");
});

test("unclosed code fences produce a warning", () => {
  const warning = "A code fence in your Markdown is never closed; GitHub will treat everything after it as code.";
  assert.deepEqual(serializeReadme([text("a", "```js\nconst x = 1;")], "").warnings, [warning]);
  assert.deepEqual(serializeReadme([text("a", "```\ncode\n```")], "").warnings, []);
  assert.deepEqual(serializeReadme([text("a", "```ts\ncode\n```\n\nok\n\n```\nmore")], "").warnings, [warning]);
  // A fence opened in one block and closed in a later one is balanced for the whole document.
  assert.deepEqual(serializeReadme([text("a", "```"), text("b", "```")], "").warnings, []);
  // Longer fences close only with an equally long fence; inline triple backticks are not fences.
  assert.deepEqual(serializeReadme([text("a", "````\n```\ninner\n```\n````")], "").warnings, []);
  assert.deepEqual(serializeReadme([text("a", "````\n```\ninner\n```")], "").warnings, [warning]);
  assert.deepEqual(serializeReadme([text("a", "use ```code``` inline")], "").warnings, []);
  assert.deepEqual(serializeReadme([], "").warnings, []);
});

test("sanitizeBlocks caps blocks and text consistently", () => {
  const many = Array.from({ length: MAX_BLOCKS + 50 }, (_, i) => ({ id: `b${i}`, type: "text", text: "x" }));
  assert.equal(sanitizeBlocks(many).length, MAX_BLOCKS);
  // Invalid entries do not use up the block budget.
  const mixed = [...Array.from({ length: 30 }, () => null), ...many];
  assert.equal(sanitizeBlocks(mixed).length, MAX_BLOCKS);
  const emoji = "a" + "😀".repeat(MAX_TEXT);
  const clipped = (sanitizeBlocks([{ id: "e", type: "text", text: emoji }])[0] as { text: string }).text;
  assert.ok(clipped.length <= MAX_TEXT);
  assert.ok(!/[\ud800-\udbff]$/.test(clipped), "no lone surrogate");
});

test("Markdown inline parsing stays fast and bounded on hostile input", () => {
  const time = (label: string, input: string) => {
    const started = performance.now();
    assert.doesNotThrow(() => parseMarkdown(input), label);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 500, `${label} took ${elapsed.toFixed(0)}ms`);
  };
  const n = 20_000;
  time("brackets", "[".repeat(n));
  time("open then text", "[a".repeat(n / 2));
  time("alternating brackets", "[]".repeat(n / 2));
  time("unclosed links", "[a](b".repeat(n / 5));
  time("closed labels", "[a]".repeat(n / 3));
  time("long label", "[" + "a".repeat(n));
  time("stars", "*".repeat(n));
  time("underscores", "_".repeat(n));
  time("backticks", "`".repeat(n));
  time("star words", "*a ".repeat(n / 3));
  time("bang brackets", "![".repeat(n / 2));
  time("spaced heading", "#" + " ".repeat(n) + "x");
  time("spaced heading end", "# a" + " ".repeat(n) + "#");
  time("spaced rule", "-" + " ".repeat(n) + "x");
  time("spaced dashes", "- ".repeat(n / 2) + "x");
  time("spaces only", " ".repeat(n));
  time("many lines", "- item\n> quote\n# h\n".repeat(n / 20));

  // Nesting far beyond any stack: the content is kept, never thrown away.
  assert.doesNotThrow(() => parseInline("[".repeat(36_000)));
  assert.doesNotThrow(() => parseInline("[".repeat(36_000) + "x" + "](https://a.example)".repeat(100)));
  let nested = "x";
  for (let i = 0; i < 40; i++) nested = `*${nested}*`.replace(/^\*\*/, "* *");
  assert.doesNotThrow(() => parseInline(nested));
  let deep = "x";
  for (let i = 0; i < 30; i++) deep = `[${deep}](https://a.example)`;
  const flatten = (items: ReturnType<typeof parseInline>): string =>
    items.map((i) => i.t === "text" || i.t === "code" ? i.v : i.t === "image" ? i.alt : flatten(i.c)).join("");
  assert.ok(flatten(parseInline(deep)).includes("x"));
  assert.ok(flatten(parseInline("**".repeat(40) + "x" + "**".repeat(40))).includes("x"));
});

test("Markdown correctness: unsafe images stay literal, *** nests, URLs may hold balanced parentheses", () => {
  assert.deepEqual(parseInline("![alt](http://unsafe.example/i.png)"), [{ t: "text", v: "![alt](http://unsafe.example/i.png)" }]);
  assert.deepEqual(parseInline("a ![x](javascript:alert(1)) b"), [{ t: "text", v: "a ![x](javascript:alert(1)) b" }]);
  assert.deepEqual(parseInline("![ok](https://i.example/a.png)"), [{ t: "image", src: "https://i.example/a.png", alt: "ok" }]);
  assert.deepEqual(parseInline("![ok](https://i.example/a.png \"title\")"), [{ t: "image", src: "https://i.example/a.png", alt: "ok" }]);

  assert.deepEqual(parseInline("***x***"), [{ t: "strong", c: [{ t: "em", c: [{ t: "text", v: "x" }] }] }]);
  assert.deepEqual(parseInline("a ***b c*** d"), [
    { t: "text", v: "a " }, { t: "strong", c: [{ t: "em", c: [{ t: "text", v: "b c" }] }] }, { t: "text", v: " d" },
  ]);
  assert.deepEqual(parseInline("**x**"), [{ t: "strong", c: [{ t: "text", v: "x" }] }]);

  assert.deepEqual(parseInline("[x](https://en.wikipedia.org/wiki/A_(b))"), [
    { t: "link", href: "https://en.wikipedia.org/wiki/A_(b)", c: [{ t: "text", v: "x" }] },
  ]);
  assert.deepEqual(parseInline("see [x](https://en.wikipedia.org/wiki/A_(b)) now"), [
    { t: "text", v: "see " }, { t: "link", href: "https://en.wikipedia.org/wiki/A_(b)", c: [{ t: "text", v: "x" }] }, { t: "text", v: " now" },
  ]);
  assert.deepEqual(parseInline("![i](https://i.example/a_(1).png)"), [{ t: "image", src: "https://i.example/a_(1).png", alt: "i" }]);
  // Only one level of nesting, and unbalanced parentheses do not link.
  assert.deepEqual(parseInline("[x](https://a.example/(b(c)))"), [{ t: "text", v: "[x](https://a.example/(b(c)))" }]);
  assert.deepEqual(parseInline("[x](https://a.example/(b)"), [{ t: "text", v: "[x](https://a.example/(b)" }]);
  assert.deepEqual(parseInline("[x](https://a.example/b) (c)"), [
    { t: "link", href: "https://a.example/b", c: [{ t: "text", v: "x" }] }, { t: "text", v: " (c)" },
  ]);

  // Headings behave as before, including closing hashes and the 0-3 space indent.
  assert.deepEqual(parseMarkdown("## Title ##"), [{ t: "heading", level: 2, c: [{ t: "text", v: "Title" }] }]);
  assert.deepEqual(parseMarkdown("   ### C#"), [{ t: "heading", level: 3, c: [{ t: "text", v: "C#" }] }]);
  assert.deepEqual(parseMarkdown("#nope").map((b) => b.t), ["paragraph"]);
  assert.deepEqual(parseMarkdown("####### seven").map((b) => b.t), ["paragraph"]);
  assert.deepEqual(parseMarkdown("    # indented").map((b) => b.t), ["paragraph"]);
  assert.deepEqual(parseMarkdown("- - -\n***\n_ _ _").map((b) => b.t), ["hr", "hr", "hr"]);
  assert.deepEqual(parseMarkdown("-- -x").map((b) => b.t), ["paragraph"]);
});

// ───────── Resizable cards and side-by-side rows ─────────
import { joinTarget, leaveRow, MAX_WIDTH, MIN_WIDTH, placeBlock, rowRanges, sameLayout, snapWidth, widthOf } from "../lib/readme-doc";

const usage = (id: string, extra: Partial<Extract<ReadmeBlock, { type: "usage" }>> = {}): ReadmeBlock =>
  ({ id, type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], ...extra });
const cal = (id: string, extra: Partial<Extract<ReadmeBlock, { type: "calendar" }>> = {}): ReadmeBlock =>
  ({ id, type: "calendar", provider: "claude", theme: "light", ...extra });
const layout = (blocks: ReadmeBlock[]) => rowRanges(blocks).map((r) => ids(blocks.slice(r.start, r.end))).join("|");

test("rows are runs of adjacent widgets sharing a row id; text is always its own row", () => {
  const blocks: ReadmeBlock[] = [text("t"), usage("a", { row: "r" }), cal("b", { row: "r" }), usage("c", { row: "r" }), text("u"),
    usage("d", { row: "r" }), usage("e"), usage("f", { row: "r" })];
  // d shares the id "r" but text separates it from the first run; e has no row; f is not adjacent to d.
  assert.equal(layout(blocks), "t|abc|u|d|e|f");
  assert.equal(layout([]), "");
  // A row id on text is ignored.
  assert.equal(layout([{ ...text("x"), row: "r" } as ReadmeBlock, text("y")]), "x|y");
  assert.equal(widthOf(usage("a")), 560);
  assert.equal(widthOf(cal("b")), 720);
  assert.equal(widthOf(usage("a", { width: 300 })), 300);
  assert.equal(widthOf(text("t")), 0);
  assert.equal(snapWidth(1), MIN_WIDTH);
  assert.equal(snapWidth(99_999), MAX_WIDTH);
  assert.equal(snapWidth(333), 330);
});

test("dropping beside a card joins its row, shrinks it to fit, and keeps sizes that already fit", () => {
  const list = [usage("a"), usage("b"), text("t")];
  const right = placeBlock(list, list[1], { beside: "a", side: "right" });
  assert.equal(layout(right), "ab|t");
  assert.equal(right[0].type === "text" ? 0 : right[0].row, right[1].type === "text" ? 1 : right[1].row);
  // 560 + 560 does not fit in 800, so both get an equal share: (800 - 8) / 2 = 396 -> 390.
  assert.deepEqual(right.slice(0, 2).map(widthOf), [390, 390]);
  const left = placeBlock(list, list[1], { beside: "a", side: "left" });
  assert.equal(layout(left), "ba|t");
  // Small cards already fit and keep their sizes; a third card joins the same row.
  const small = [usage("a", { width: 250 }), usage("b", { width: 250 }), usage("c", { width: 200 })];
  const row2 = placeBlock(small, small[1], { beside: "a", side: "right" });
  assert.deepEqual(row2.slice(0, 2).map(widthOf), [250, 250]);
  const row3 = placeBlock(row2, row2[2], { beside: "b", side: "right" });
  assert.equal(layout(row3), "abc");
  assert.deepEqual(row3.map(widthOf), [250, 250, 200]);
  // A fourth card pushes the row past 800px, so every card gets an equal share.
  const row4 = placeBlock([...row3, usage("d", { width: 200 })], { ...usage("d", { width: 200 }) }, { beside: "c", side: "right" });
  assert.deepEqual(row4.map(widthOf), [190, 190, 190, 190].map((w) => Math.max(MIN_WIDTH, w)));
  // Text can't be placed beside, and nothing can be placed beside text or beside itself.
  assert.equal(placeBlock(list, text("new"), { beside: "a", side: "right" }), list);
  assert.equal(placeBlock(list, list[0], { beside: "t", side: "right" }), list);
  assert.equal(placeBlock(list, list[0], { beside: "ghost", side: "right" }), list);
  // A brand-new block (not yet in the list) can be dropped beside too.
  assert.equal(layout(placeBlock(list, cal("n"), { beside: "b", side: "right" })), "a|bn|t");
});

test("dropping into a slot takes a card out of its row; leaving a row never strands the others", () => {
  const row: ReadmeBlock[] = [usage("a", { row: "r", width: 300 }), usage("b", { row: "r", width: 300 }), usage("c", { row: "r", width: 200 }), text("t")];
  const out = placeBlock(row, row[1], { slot: 4 });
  assert.equal(ids(out), "actb");
  assert.equal(layout(out), "ac|t|b");
  assert.equal(widthOf(out[3]), 300); // keeps its size, loses its row
  assert.equal("row" in out[3], false);
  // Dropping a block back where it already is, without a row, is a no-op layout.
  const plain = [usage("a"), usage("b")];
  assert.ok(sameLayout(placeBlock(plain, plain[0], { slot: 0 }), plain));
  assert.ok(sameLayout(placeBlock(plain, plain[0], { slot: 1 }), plain));
  assert.ok(!sameLayout(placeBlock(plain, plain[0], { slot: 2 }), plain));
  assert.ok(!sameLayout(placeBlock(row, row[1], { slot: 3 }), row)); // b leaves the row even though order is the same
  // leaveRow puts the card on its own row after the row it left.
  assert.equal(layout(leaveRow(row, "a")), "bc|a|t");
  assert.equal(layout(leaveRow(row, "c")), "ab|c|t");
  assert.equal(leaveRow(row, "t"), row);
  assert.equal(leaveRow(plain, "a"), plain);
  // Removing a member simply shortens the row.
  assert.equal(layout(row.filter((b) => b.id !== "b")), "ac|t");
  assert.equal(layout(row.filter((b) => b.id !== "a" && b.id !== "c")), "b|t");
});

test("arrows swap inside a row, stop at its edge, and jump whole rows otherwise", () => {
  const list: ReadmeBlock[] = [text("t"), usage("a", { row: "r" }), usage("b", { row: "r" }), usage("c", { row: "r" }), usage("d"), text("u")];
  assert.equal(ids(stepBlock(list, "b", -1)), "tbacdu");
  assert.equal(ids(stepBlock(list, "b", 1)), "tacbdu");
  assert.equal(stepBlock(list, "a", -1), list); // edge of its row: no-op
  assert.equal(stepBlock(list, "c", 1), list);
  assert.equal(layout(stepBlock(list, "b", -1)), "t|bac|d|u");
  // A card on its own row jumps over the neighbouring row, not into it.
  assert.equal(ids(stepBlock(list, "d", -1)), "tdabcu");
  assert.equal(layout(stepBlock(list, "d", -1)), "t|d|abc|u");
  assert.equal(ids(stepBlock(list, "t", 1)), "abctdu");
  assert.equal(stepBlock(list, "u", 1), list);
});

test("a lone card can join the card at the end of the previous row", () => {
  const list: ReadmeBlock[] = [usage("a"), usage("b", { row: "r" }), usage("c", { row: "r" }), usage("d"), text("t"), usage("e")];
  assert.equal(joinTarget(list, "d"), "c");
  assert.equal(joinTarget(list, "a"), null); // nothing before it
  assert.equal(joinTarget(list, "b"), null); // already in a row of two
  assert.equal(joinTarget(list, "e"), null); // text sits before it
  assert.equal(joinTarget(list, "t"), null);
  assert.equal(layout(placeBlock(list, list[3], { beside: "c", side: "right" })), "a|bcd|t|e");
});

test("resized and side-by-side cards serialize to <img> tags; untouched cards stay Markdown", () => {
  const origin = "https://atlas.example";
  const plain = serializeReadme([usage("a")], origin).markdown;
  assert.match(plain, /^!\[My recorded Codex usage\]\(https:\/\/atlas\.example\/api\/card\?/);
  const sized = serializeReadme([usage("a", { width: 300 })], origin).markdown;
  assert.equal(sized, '<p>\n  <img src="https://atlas.example/api/card?provider=codex&amp;theme=dark&amp;metrics=tokens" alt="My recorded Codex usage" width="300">\n</p>\n');
  const row = serializeReadme([text("h", "## Hi"), usage("a", { row: "r", width: 390 }), cal("b", { row: "r", width: 390 }), text("t", "bye")], origin).markdown;
  assert.equal(row, [
    "## Hi", "",
    "<p>",
    '  <img src="https://atlas.example/api/card?provider=codex&amp;theme=dark&amp;metrics=tokens" alt="My recorded Codex usage" width="390">',
    '  <img src="https://atlas.example/api/card?kind=calendar&amp;provider=claude&amp;theme=light" alt="My recorded Claude Code activity" width="390">',
    "</p>", "", "bye", "",
  ].join("\n"));
  // A row of two with no explicit widths still becomes one paragraph (natural size, no width attribute).
  const natural = serializeReadme([usage("a", { row: "r" }), usage("b", { row: "r" })], origin).markdown;
  assert.equal((natural.match(/<img /g) || []).length, 2);
  assert.equal(natural.includes("width="), false);
  // Missing origin is still reported for HTML output, and the placeholder host is used.
  const unset = serializeReadme([usage("a", { width: 300 })], "");
  assert.ok(unset.originError);
  assert.ok(unset.markdown.includes(PLACEHOLDER_ORIGIN));
});

test("stored layout is validated: widths must be sane integers, row ids short strings", () => {
  const clean = sanitizeBlocks([
    { id: "1", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], width: 300, row: "r" },
    { id: "2", type: "calendar", provider: "codex", theme: "dark", width: 5, row: "" },
    { id: "3", type: "calendar", provider: "codex", theme: "dark", width: 801 },
    { id: "4", type: "calendar", provider: "codex", theme: "dark", width: 300.5, row: 7 },
    { id: "5", type: "calendar", provider: "codex", theme: "dark", width: "300", row: "x".repeat(65) },
    { id: "6", type: "calendar", provider: "codex", theme: "dark", width: MAX_WIDTH, row: "ok" },
    { id: "7", type: "text", text: "hi", width: 300, row: "r" },
  ]);
  assert.deepEqual(clean, [
    { id: "1", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], width: 300, row: "r" },
    { id: "2", type: "calendar", provider: "codex", theme: "dark" },
    { id: "3", type: "calendar", provider: "codex", theme: "dark" },
    { id: "4", type: "calendar", provider: "codex", theme: "dark" },
    { id: "5", type: "calendar", provider: "codex", theme: "dark" },
    { id: "6", type: "calendar", provider: "codex", theme: "dark", width: 800, row: "ok" },
    { id: "7", type: "text", text: "hi" },
  ]);
});

// ───────── Card styles, accents and presets ─────────
import { cardAccents, cardSize, cardStyles, providerAccent, renderProfileCard, stylesFor } from "../lib/profile-card";
import { sampleSnapshot } from "../lib/sample-snapshot";
import { PRESET_GROUPS } from "../lib/readme-doc";

test("cards take a validated style and accent; defaults stay out of embed URLs", () => {
  const options = (query: string) => cardOptions(new URL(`https://atlas.example/api/card?${query}`));
  assert.deepEqual([options("").style, options("").accent], ["classic", "lime"]);
  assert.deepEqual([options("style=compact&accent=violet").style, options("style=spotlight&accent=mono").accent], ["compact", "mono"]);
  assert.equal(options("kind=calendar&style=compact").style, "compact");
  for (const query of ["style=big", "style=", "style=compact&style=classic", "accent=pink", "accent=", "accent=lime&accent=blue",
    "kind=calendar&style=spotlight", "style=<script>", "accent=ORANGE"])
    assert.throws(() => options(query), query);
  assert.deepEqual(stylesFor("calendar"), ["classic", "compact"]);
  assert.deepEqual(stylesFor("usage"), cardStyles);

  const plain = profileEmbed("https://atlas.example", "codex", "dark", ["tokens"]);
  assert.equal(profileEmbed("https://atlas.example", "codex", "dark", ["tokens"], { style: "classic", accent: "lime" }).image, plain.image);
  const styled = new URL(profileEmbed("https://atlas.example", "claude", "light", ["tokens"], { style: "compact", accent: "orange" }).image);
  assert.deepEqual([styled.searchParams.get("style"), styled.searchParams.get("accent")], ["compact", "orange"]);
  const calendar = new URL(calendarEmbed("https://atlas.example", "cursor", "dark", { style: "compact", accent: "blue" }).image);
  assert.deepEqual([calendar.searchParams.get("kind"), calendar.searchParams.get("style"), calendar.searchParams.get("accent")], ["calendar", "compact", "blue"]);
});

test("every style and accent renders a well-formed card of the advertised size, with no extra data", async () => {
  const snapshot = sampleSnapshot("codex", Date.parse("2026-10-21T08:00:00Z"));
  snapshot.coverage.warnings = ["<script>private-project-path</script>"];
  for (const accent of cardAccents) for (const theme of ["dark", "light"] as const) {
    for (const style of cardStyles) {
      const svg = renderProfileCard(snapshot, "codex", theme, ["tokens", "sessions", "requests"], { style, accent });
      const { width, height } = cardSize("usage", style);
      assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`), `${style}/${accent}`);
      assert.match(svg, /<title id="title">Codex usage<\/title>/);
      assert.match(svg, /RECORDED TOKENS/);
      for (const leaked of ["private-project-path", "<script>"]) assert.equal(svg.includes(leaked), false);
      assert.equal((svg.match(/<svg/g) || []).length, 1);
    }
    for (const style of ["classic", "compact"] as const) {
      const svg = renderActivityCalendar(snapshot, "codex", theme, { style, accent });
      const { width, height } = cardSize("calendar", style);
      assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`), `${style}/${accent}`);
    }
  }
  // Compact is slimmer than classic; spotlight puts the first metric in a big font; compact calendars drop the footer.
  assert.ok(cardSize("usage", "compact").height < cardSize("usage").height);
  assert.match(renderProfileCard(snapshot, "codex", "dark", ["sessions", "tokens"], { style: "spotlight" }), /font-size="54"[^>]*>[\d.,KMB]+<\/text>/);
  const classic = renderActivityCalendar(snapshot, "codex", "dark");
  const slim = renderActivityCalendar(snapshot, "codex", "dark", { style: "compact" });
  assert.ok(classic.includes("available history, not verified account lifetime</text>"));
  assert.equal(slim.includes("available history, not verified account lifetime</text>"), false);
  assert.match(slim, /<desc id="desc">[^<]*Available history, not verified account lifetime\./); // the honesty note stays in the description
  // An accent changes colours only: the default accent is still byte-identical to a call without a look.
  assert.equal(renderProfileCard(snapshot, "codex", "dark", ["tokens"], { style: "classic", accent: "lime" }), renderProfileCard(snapshot, "codex", "dark", ["tokens"]));
  assert.notEqual(renderProfileCard(snapshot, "codex", "dark", ["tokens"], { accent: "violet" }), renderProfileCard(snapshot, "codex", "dark", ["tokens"]));
  assert.ok(renderProfileCard(snapshot, "claude", "dark", ["tokens"], { accent: "orange" }).includes("#e8a67b"));
  // Unavailable metrics stay readable in every layout.
  snapshot.availability = { tokens: false, cost: false, sessions: true, humanRequests: true, assistantRequests: false, cacheBreakdown: false };
  for (const style of cardStyles)
    assert.match(renderProfileCard(snapshot, "cursor", "dark", ["tokens", "sessions"], { style }), />Unavailable<\/text>/);
});

test("presets: each provider has distinct, ready-made looks that survive saving", () => {
  assert.deepEqual(PRESET_GROUPS, ["Usage cards", "Activity calendars", "Markdown"]);
  const usage = PRESETS.filter((p) => p.group === "Usage cards"), calendars = PRESETS.filter((p) => p.group === "Activity calendars");
  for (const provider of ["codex", "claude", "cursor", "antigravity"] as const) {
    const mine = usage.filter((p) => p.provider === provider);
    assert.deepEqual(mine.map((p) => p.variant), ["Classic", "Compact", "Spotlight", "Light"]);
    assert.deepEqual(calendars.filter((p) => p.provider === provider).map((p) => p.variant), ["Classic", "Compact", "Light"]);
    for (const preset of [...mine, ...calendars.filter((p) => p.provider === provider)])
      assert.equal((preset.block as { accent?: string }).accent, providerAccent[provider]);
  }
  // Every preset is distinguishable: no two card presets produce the same embed URL.
  const urls = PRESETS.filter((p) => p.block.type !== "text").map((p) => {
    const b = { ...p.block, id: "x" } as ReadmeBlock;
    return serializeReadme([b], "https://atlas.example").markdown;
  });
  assert.equal(new Set(urls).size, urls.length);
  for (const preset of PRESETS.filter((p) => p.group === "Markdown")) assert.equal(preset.provider, undefined);
});

test("stored styles are validated per kind", () => {
  const clean = sanitizeBlocks([
    { id: "1", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], style: "spotlight", accent: "violet" },
    { id: "2", type: "calendar", provider: "codex", theme: "dark", style: "spotlight", accent: "mono" },
    { id: "3", type: "calendar", provider: "codex", theme: "dark", style: "compact", accent: "pink" },
    { id: "4", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], style: "classic", accent: "lime" },
    { id: "5", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], style: { x: 1 }, accent: ["blue"] },
    { id: "6", type: "text", text: "t", style: "compact", accent: "blue" },
  ]);
  assert.deepEqual(clean, [
    { id: "1", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], style: "spotlight", accent: "violet" },
    { id: "2", type: "calendar", provider: "codex", theme: "dark", accent: "mono" },
    { id: "3", type: "calendar", provider: "codex", theme: "dark", style: "compact" },
    { id: "4", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"], accent: "lime" },
    { id: "5", type: "usage", provider: "codex", theme: "dark", metrics: ["tokens"] },
    { id: "6", type: "text", text: "t" },
  ]);
});

test("sample data is deterministic, plausible and never mistaken for the real thing", () => {
  const now = Date.parse("2026-10-21T08:00:00Z");
  assert.deepEqual(sampleSnapshot("claude", now), sampleSnapshot("claude", now));
  assert.notDeepEqual(sampleSnapshot("claude", now).daily, sampleSnapshot("codex", now).daily);
  const sample = sampleSnapshot("cursor", now);
  assert.ok(sample.daily.length > 150 && sample.daily.length < 365);
  assert.equal(sample.totals.totalTokens, sample.daily.reduce((sum, d) => sum + d.totalTokens, 0));
  assert.equal(sample.provider, "cursor");
  assert.ok(Date.parse(sample.generatedAt) === now);
  assert.match(renderActivityCalendar(sample, "cursor", "dark"), /active days/);
});
