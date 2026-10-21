// A small, dependency-free Markdown subset for the README preview. It produces a tree that React
// renders as elements, so user text can never become raw HTML. GitHub renders the full syntax.
export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "image"; src: string; alt: string };

export type MdBlock =
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "paragraph"; c: Inline[] }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; text: string }
  | { t: "hr" };

// Only absolute web URLs survive: javascript:, data: and relative targets become plain text.
export function safeUrl(value: string, kind: "link" | "image"): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  return (kind === "image" ? ["https:"] : ["https:", "http:", "mailto:"]).includes(url.protocol) ? url.href : null;
}

// Limits keep hostile input linear-time: a link label may span at most MAX_LABEL characters and
// MAX_BRACKETS nested brackets, a URL or title is bounded too, and inline nesting stops at MAX_DEPTH
// (deeper content is shown as plain text), so no input can cause a stack overflow or a scan per character.
const MAX_LABEL = 2000, MAX_BRACKETS = 8, MAX_URL = 2000, MAX_TITLE = 500, MAX_DEPTH = 6;
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

// Matches `[label](target)` at `start`, allowing nested brackets such as `[![badge](img)](link)`.
// The target may hold one level of balanced parentheses (`[x](https://en.wikipedia.org/wiki/A_(b))`)
// and an optional "title". Reference-style links and autolinks are not part of this subset.
function matchLink(src: string, start: number) {
  let depth = 0, close = -1;
  const limit = Math.min(src.length, start + MAX_LABEL);
  for (let i = start; i < limit; i++) {
    const ch = src[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "[") { if (++depth > MAX_BRACKETS) return null; }
    else if (ch === "]" && --depth === 0) { close = i; break; }
  }
  if (close < 0 || src[close + 1] !== "(") return null;
  let p = close + 2;
  while (p < src.length && isSpace(src[p])) p++;
  const urlStart = p;
  let parens = 0;
  for (; p < src.length && p - urlStart <= MAX_URL; p++) {
    const c = src[p];
    if (isSpace(c)) break;
    if (c === "(") { if (++parens > 1) return null; }
    else if (c === ")") { if (parens === 0) break; parens--; }
  }
  if (p === urlStart || p - urlStart > MAX_URL || parens > 0) return null;
  const href = src.slice(urlStart, p);
  const spaced = p < src.length && isSpace(src[p]);
  while (p < src.length && isSpace(src[p])) p++;
  if (spaced && src[p] === '"') {
    const titleStart = p++;
    while (p < src.length && src[p] !== '"' && p - titleStart <= MAX_TITLE) p++;
    if (src[p] !== '"') return null;
    p++;
    while (p < src.length && isSpace(src[p])) p++;
  }
  return src[p] === ")" ? { label: src.slice(start + 1, close), href, end: p + 1 } : null;
}

export function parseInline(src: string): Inline[] {
  return inline(src, 0);
}

function inline(src: string, depth: number): Inline[] {
  if (depth > MAX_DEPTH) return src ? [{ t: "text", v: src }] : [];
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!>~|]/.test(src[i + 1])) { text += src[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) { flush(); out.push({ t: "code", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === "!" && src[i + 1] === "[") {
      const link = matchLink(src, i + 1);
      if (link) {
        const image = safeUrl(link.href, "image");
        if (image) { flush(); out.push({ t: "image", src: image, alt: link.label }); }
        else text += src.slice(i, link.end); // an unsafe image stays visible as literal text, in full
        i = link.end;
        continue;
      }
    }
    if (ch === "[") {
      const link = matchLink(src, i), href = link && safeUrl(link.href, "link");
      if (link && href) { flush(); out.push({ t: "link", href, c: inline(link.label, depth + 1) }); i = link.end; continue; }
    }
    if (src.startsWith("***", i)) {
      const end = src.indexOf("***", i + 3);
      if (end > i + 3) {
        flush(); out.push({ t: "strong", c: [{ t: "em", c: inline(src.slice(i + 3, end), depth + 2) }] });
        i = end + 3; continue;
      }
    }
    if (src.startsWith("**", i) || src.startsWith("__", i)) {
      const mark = src.slice(i, i + 2), end = src.indexOf(mark, i + 2);
      if (end > i + 2) { flush(); out.push({ t: "strong", c: inline(src.slice(i + 2, end), depth + 1) }); i = end + 2; continue; }
    }
    // Underscores inside words (snake_case) are not emphasis.
    if ((ch === "*" || (ch === "_" && !/\w/.test(src[i - 1] ?? ""))) && src[i + 1] && !/\s/.test(src[i + 1])) {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && (ch === "*" || !/\w/.test(src[end + 1] ?? ""))) {
        flush(); out.push({ t: "em", c: inline(src.slice(i + 1, end), depth + 1) }); i = end + 1; continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^\s{0,3}```/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^\s*([-*+]|\d+[.)])\s+/;

// Headings and rules are matched by hand rather than with backtracking regexes, so a very long
// whitespace-only line cannot stall the preview.
function parseHeading(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  let p = 0;
  while (p < line.length && p < 4 && /\s/.test(line[p])) p++;
  if (p > 3) return null;
  let level = 0;
  while (line[p + level] === "#") level++;
  if (level < 1 || level > 6 || !/\s/.test(line[p + level] ?? "")) return null;
  let text = line.slice(p + level).trim(), j = text.length;
  while (j > 0 && text[j - 1] === "#") j--;
  if (j > 0 && j < text.length && /\s/.test(text[j - 1])) text = text.slice(0, j).trimEnd(); // closing #s
  return { level: level as 1, text };
}

function isRule(line: string) {
  let p = 0;
  while (p < line.length && p < 4 && /\s/.test(line[p])) p++;
  const mark = line[p];
  if (p > 3 || (mark !== "-" && mark !== "*" && mark !== "_")) return false;
  let count = 0;
  for (; p < line.length; p++) {
    if (line[p] === mark) count++;
    else if (!/\s/.test(line[p])) return false;
  }
  return count >= 3;
}
const startsBlock = (line: string) =>
  FENCE.test(line) || parseHeading(line) !== null || isRule(line) || QUOTE.test(line) || ITEM.test(line);

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (FENCE.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) body.push(lines[i]);
      i++; // closing fence (an unclosed one runs to the end, as on GitHub)
      blocks.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const heading = parseHeading(line);
    if (heading) { blocks.push({ t: "heading", level: heading.level, c: parseInline(heading.text) }); i++; continue; }
    if (isRule(line)) { blocks.push({ t: "hr" }); i++; continue; }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) body.push(lines[i].replace(QUOTE, ""));
      blocks.push({ t: "quote", c: parseInline(body.join(" ").trim()) });
      continue;
    }
    if (ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line), items: Inline[][] = [];
      for (; i < lines.length && ITEM.test(lines[i]); i++) items.push(parseInline(lines[i].replace(ITEM, "").trim()));
      blocks.push({ t: "list", ordered, items });
      continue;
    }
    const body: string[] = [];
    for (; i < lines.length && lines[i].trim() && (body.length === 0 || !startsBlock(lines[i])); i++) body.push(lines[i].trim());
    blocks.push({ t: "paragraph", c: parseInline(body.join(" ")) });
  }
  return blocks;
}
