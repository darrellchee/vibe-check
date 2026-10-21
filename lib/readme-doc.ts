import { PROVIDERS, providerName } from "./providers";
import { calendarEmbed, cardAccents, cardMetrics, cardStyles, calendarStyles, profileEmbed, providerAccent,
  type CardAccent, type CardMetric, type CardStyle, type CardTheme } from "./profile-card";
import type { UsageProvider } from "./types";

// The README is an ordered list of blocks: free Markdown text, or a widget that becomes an image
// served by this instance's public card endpoint.
//
// Widgets can be resized (`width`, in CSS pixels) and placed side by side: neighbouring widgets that
// share a `row` id form one row. A row is derived from the list, never stored separately, so moving or
// removing a block can't leave the layout inconsistent. Text is always a row of its own.
export type ReadmeBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "usage"; provider: UsageProvider; theme: CardTheme; metrics: CardMetric[]; style?: CardStyle; accent?: CardAccent; width?: number; row?: string }
  | { id: string; type: "calendar"; provider: UsageProvider; theme: CardTheme; style?: CardStyle; accent?: CardAccent; width?: number; row?: string };
export type NewBlock = ReadmeBlock extends infer B ? (B extends { id: string } ? Omit<B, "id"> : never) : never;

export type PresetGroup = "Usage cards" | "Activity calendars" | "Markdown";
// Card presets belong to a provider and name their look (`variant`); Markdown presets have neither.
export interface Preset { id: string; group: PresetGroup; title: string; hint: string; block: NewBlock; provider?: UsageProvider; variant?: string }
export const PRESET_GROUPS: PresetGroup[] = ["Usage cards", "Activity calendars", "Markdown"];

type CardBlock = Exclude<NewBlock, { type: "text" }>;
const USAGE_LOOKS: { variant: string; hint: string; look: (accent: CardAccent) => Partial<Extract<CardBlock, { type: "usage" }>> }[] = [
  { variant: "Classic", hint: "Tokens and sessions", look: (accent) => ({ accent, metrics: ["tokens", "sessions"] }) },
  { variant: "Compact", hint: "One slim row, three metrics", look: (accent) => ({ accent, style: "compact", metrics: ["tokens", "sessions", "requests"] }) },
  { variant: "Spotlight", hint: "One big number", look: (accent) => ({ accent, style: "spotlight", metrics: ["tokens", "sessions"] }) },
  { variant: "Light", hint: "Classic on a light background", look: (accent) => ({ accent, theme: "light", metrics: ["tokens", "sessions", "requests"] }) },
];
const CALENDAR_LOOKS: { variant: string; hint: string; look: (accent: CardAccent) => Partial<Extract<CardBlock, { type: "calendar" }>> }[] = [
  { variant: "Classic", hint: "Last 12 months", look: (accent) => ({ accent }) },
  { variant: "Compact", hint: "Just the heatmap", look: (accent) => ({ accent, style: "compact" }) },
  { variant: "Light", hint: "Last 12 months, light", look: (accent) => ({ accent, theme: "light" }) },
];

export const PRESETS: Preset[] = [
  ...PROVIDERS.flatMap((provider) => USAGE_LOOKS.map(({ variant, hint, look }): Preset => ({
    id: `usage-${provider}-${variant.toLowerCase()}`, group: "Usage cards", title: providerName(provider), variant, hint, provider,
    block: { type: "usage", provider, theme: "dark", metrics: ["tokens", "sessions"], ...look(providerAccent[provider]) },
  }))),
  ...PROVIDERS.flatMap((provider) => CALENDAR_LOOKS.map(({ variant, hint, look }): Preset => ({
    id: `calendar-${provider}-${variant.toLowerCase()}`, group: "Activity calendars", title: providerName(provider), variant, hint, provider,
    block: { type: "calendar", provider, theme: "dark", ...look(providerAccent[provider]) },
  }))),
  { id: "heading", group: "Markdown", title: "Heading", hint: "Section title", block: { type: "text", text: "## What I build with AI" } },
  { id: "paragraph", group: "Markdown", title: "Paragraph", hint: "A few sentences", block: { type: "text", text: "I use AI coding tools every day. Here is what my recorded usage looks like." } },
  { id: "list", group: "Markdown", title: "Bullet list", hint: "Tools you use", block: { type: "text", text: "- Codex\n- Claude Code\n- Cursor\n- Antigravity" } },
  { id: "divider", group: "Markdown", title: "Divider", hint: "Horizontal rule", block: { type: "text", text: "---" } },
  { id: "text", group: "Markdown", title: "Custom Markdown", hint: "Write anything", block: { type: "text", text: "" } },
];

let counter = 0;
export const newId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const makeBlock = (block: NewBlock): ReadmeBlock => ({ ...structuredClone(block), id: newId() }) as ReadmeBlock;

export function insertBlock(blocks: ReadmeBlock[], index: number, block: ReadmeBlock) {
  const at = Math.max(0, Math.min(index, blocks.length));
  return [...blocks.slice(0, at), block, ...blocks.slice(at)];
}

// `to` is an insertion slot in the current list (0 = before the first block, length = after the last).
export function moveBlock(blocks: ReadmeBlock[], id: string, to: number) {
  const from = blocks.findIndex((b) => b.id === id);
  if (from < 0) return blocks;
  const target = Math.max(0, Math.min(to > from ? to - 1 : to, blocks.length - 1));
  if (target === from) return blocks;
  const next = [...blocks];
  next.splice(target, 0, next.splice(from, 1)[0]);
  return next;
}

// ───────── Size and rows ─────────
// Native sizes of the SVGs, and the width GitHub gives a README (about 800px of a profile column).
export const NATIVE_WIDTH = { usage: 560, calendar: 720 } as const;
export const MIN_WIDTH = 200, MAX_WIDTH = 800, ROW_BUDGET = 800, ROW_GAP = 8;

export const widthOf = (b: ReadmeBlock) => (b.type === "text" ? 0 : b.width ?? NATIVE_WIDTH[b.type]);
export const snapWidth = (width: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width / 10) * 10));
const stripRow = (b: ReadmeBlock): ReadmeBlock => {
  if (b.type === "text" || b.row === undefined) return b;
  const { row, ...rest } = b;
  void row;
  return rest as ReadmeBlock;
};

export interface RowRange { start: number; end: number } // `end` is exclusive

// Rows are runs of adjacent widgets with the same row id; every text block is a row by itself.
export function rowRanges(blocks: ReadmeBlock[]): RowRange[] {
  const rows: RowRange[] = [];
  blocks.forEach((b, i) => {
    const last = blocks[i - 1];
    if (rows.length && b.type !== "text" && last?.type !== "text" && b.row && b.row === (last as { row?: string }).row)
      rows[rows.length - 1].end = i + 1;
    else rows.push({ start: i, end: i + 1 });
  });
  return rows;
}

const withWidth = (b: ReadmeBlock, width: number) => (b.type === "text" ? b : { ...b, width }) as ReadmeBlock;

// When a row would be wider than the README, give its cards equal shares of the width. Rows that
// already fit keep the sizes the user chose.
function fitRow(blocks: ReadmeBlock[], id: string): ReadmeBlock[] {
  const at = blocks.findIndex((b) => b.id === id);
  const range = rowRanges(blocks).find((r) => at >= r.start && at < r.end);
  if (!range || range.end - range.start < 2) return blocks;
  const members = blocks.slice(range.start, range.end), count = members.length;
  const total = members.reduce((sum, b) => sum + widthOf(b), 0) + ROW_GAP * (count - 1);
  if (total <= ROW_BUDGET) return blocks;
  const share = Math.max(MIN_WIDTH, Math.floor((ROW_BUDGET - ROW_GAP * (count - 1)) / count / 10) * 10);
  return blocks.map((b, i) => (i >= range.start && i < range.end ? withWidth(b, share) : b));
}

// A drop is either a slot between rows (an index into the current list) or beside an existing card.
export type DropTarget = { slot: number } | { beside: string; side: "left" | "right" };

// Put `moving` (a block already in the list, or a new one) at `target`. Dropping beside a card joins
// that card's row; dropping into a slot puts the block on a row of its own.
export function placeBlock(blocks: ReadmeBlock[], moving: ReadmeBlock, target: DropTarget): ReadmeBlock[] {
  const from = blocks.findIndex((b) => b.id === moving.id);
  const rest = blocks.filter((b) => b.id !== moving.id);
  if ("beside" in target) {
    const at = rest.findIndex((b) => b.id === target.beside), anchor = rest[at];
    if (!anchor || anchor.type === "text" || moving.type === "text") return blocks;
    const row = anchor.row ?? newId();
    const next = [...rest];
    next[at] = { ...anchor, row } as ReadmeBlock;
    next.splice(target.side === "left" ? at : at + 1, 0, { ...moving, row } as ReadmeBlock);
    return fitRow(next, moving.id);
  }
  const slot = from >= 0 && target.slot > from ? target.slot - 1 : target.slot;
  const next = [...rest];
  next.splice(Math.max(0, Math.min(slot, rest.length)), 0, stripRow(moving));
  return next;
}

// True when two lists lay out identically (same blocks, order and rows), so a drop would change nothing.
export const sameLayout = (a: ReadmeBlock[], b: ReadmeBlock[]) =>
  a === b || (a.length === b.length && a.every((x, i) => x.id === b[i].id && (x.type === "text" ? "" : x.row ?? "") === (b[i].type === "text" ? "" : (b[i] as { row?: string }).row ?? "")));

// The card at the end of the previous row, when this block is alone on its row and could join it.
export function joinTarget(blocks: ReadmeBlock[], id: string): string | null {
  const at = blocks.findIndex((b) => b.id === id);
  const ranges = rowRanges(blocks), r = ranges.findIndex((range) => at >= range.start && at < range.end);
  if (r < 1 || blocks[at].type === "text" || ranges[r].end - ranges[r].start !== 1) return null;
  const previous = blocks[ranges[r - 1].end - 1];
  return previous.type === "text" ? null : previous.id;
}

// Take a card out of its row and put it on its own row, just after the row it left.
export function leaveRow(blocks: ReadmeBlock[], id: string): ReadmeBlock[] {
  const at = blocks.findIndex((b) => b.id === id);
  const range = rowRanges(blocks).find((r) => at >= r.start && at < r.end);
  if (!range || blocks[at].type === "text" || range.end - range.start < 2) return blocks;
  return placeBlock(blocks, blocks[at], { slot: range.end });
}

// Arrows reorder in reading order. Inside a row they swap neighbours (and stop at the row's edge);
// a card on its own row jumps past the neighbouring row.
export function stepBlock(blocks: ReadmeBlock[], id: string, delta: -1 | 1) {
  const at = blocks.findIndex((b) => b.id === id);
  if (at < 0) return blocks;
  const ranges = rowRanges(blocks), r = ranges.findIndex((range) => at >= range.start && at < range.end);
  if (ranges[r].end - ranges[r].start > 1) {
    const to = at + delta;
    if (to < ranges[r].start || to >= ranges[r].end) return blocks;
    const next = [...blocks];
    [next[at], next[to]] = [next[to], next[at]];
    return next;
  }
  const other = ranges[r + delta];
  return other ? moveBlock(blocks, id, delta < 0 ? other.start : other.end) : blocks;
}

export const PLACEHOLDER_ORIGIN = "https://your-instance.vercel.app";
export const MAX_TEXT = 20_000, MAX_BLOCKS = 200;

// Text keeps its own indentation (indented code, nested lists): only blank lines before the first
// line of content and whitespace after the last are removed.
const attribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const tidyText = (text: string) => text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();

// True when a ``` fence is opened and never closed. GitHub then renders everything after it as code,
// including the image links this editor adds below the text.
function hasUnclosedFence(markdown: string) {
  let open = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const ticks = /^ {0,3}(`{3,})(.*)$/.exec(line);
    if (!ticks) continue;
    if (!open) { if (!ticks[2].includes("`")) open = ticks[1].length; }
    else if (ticks[1].length >= open && !ticks[2].trim()) open = 0;
  }
  return open > 0;
}

// Widget URLs need a public HTTPS origin. Until one is entered the output uses a placeholder and
// reports `originError` (the friendly message from the URL check), so callers can refuse to hand out
// Markdown that GitHub could not load. `warnings` flags Markdown that will render surprisingly.
export function serializeReadme(blocks: ReadmeBlock[], origin: string) {
  const hasWidgets = blocks.some((b) => b.type !== "text");
  let base = origin, originError = "";
  if (hasWidgets) {
    try { profileEmbed(origin, "codex", "dark", ["tokens"]); }
    catch (error) { originError = (error as Error).message; base = PLACEHOLDER_ORIGIN; }
  }
  const embed = (b: Exclude<ReadmeBlock, { type: "text" }>) =>
    b.type === "usage" ? profileEmbed(base, b.provider, b.theme, b.metrics, { style: b.style, accent: b.accent })
      : calendarEmbed(base, b.provider, b.theme, { style: b.style, accent: b.accent });
  // Markdown images cannot carry a size or share a line, so resized and side-by-side cards become
  // <img> tags in one paragraph. GitHub keeps width and flows adjacent inline images side by side.
  const parts = rowRanges(blocks).map(({ start, end }) => {
    const row = blocks.slice(start, end);
    const first = row[0];
    if (first.type === "text") return tidyText(first.text);
    const cards = (row as Exclude<ReadmeBlock, { type: "text" }>[]).map((b) => ({ b, e: embed(b) }));
    if (cards.length === 1 && cards[0].b.width === undefined) return cards[0].e.markdown;
    const images = cards.map(({ b, e }) =>
      `  <img src="${attribute(e.image)}" alt="${attribute(e.alt)}"${b.width === undefined ? "" : ` width="${b.width}"`}>`);
    return `<p>\n${images.join("\n")}\n</p>`;
  }).filter(Boolean);
  const markdown = parts.length ? `${parts.join("\n\n")}\n` : "";
  const warnings: string[] = [];
  if (hasUnclosedFence(markdown))
    warnings.push("A code fence in your Markdown is never closed; GitHub will treat everything after it as code.");
  return { markdown, originError, warnings };
}

const isTheme = (v: unknown): v is CardTheme => v === "dark" || v === "light";
const isProvider = (v: unknown): v is UsageProvider => PROVIDERS.includes(v as UsageProvider);
// Cut at MAX_TEXT without leaving half of a surrogate pair behind.
const clipText = (text: string) => {
  const clipped = text.slice(0, MAX_TEXT), last = clipped.charCodeAt(clipped.length - 1);
  return text.length > MAX_TEXT && last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
};

// Rebuild blocks from untrusted storage, keeping only fields we understand. At most MAX_BLOCKS valid
// blocks are kept, and each text block is capped at MAX_TEXT characters.
export function sanitizeBlocks(value: unknown): ReadmeBlock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(), out: ReadmeBlock[] = [];
  for (const raw of value) {
    if (out.length >= MAX_BLOCKS) break;
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id || b.id.length > 64 || seen.has(b.id)) continue;
    const layout = {
      ...(typeof b.width === "number" && Number.isInteger(b.width) && b.width >= MIN_WIDTH && b.width <= MAX_WIDTH ? { width: b.width } : {}),
      ...(typeof b.row === "string" && b.row && b.row.length <= 64 ? { row: b.row } : {}),
    };
    const look = (styles: CardStyle[]) => ({
      ...(styles.includes(b.style as CardStyle) && b.style !== "classic" ? { style: b.style as CardStyle } : {}),
      ...(cardAccents.includes(b.accent as CardAccent) ? { accent: b.accent as CardAccent } : {}),
    });
    if (b.type === "text" && typeof b.text === "string") out.push({ id: b.id, type: "text", text: clipText(b.text) });
    else if (b.type === "usage" && isProvider(b.provider) && isTheme(b.theme) && Array.isArray(b.metrics)) {
      const metrics = cardMetrics.filter((m) => (b.metrics as unknown[]).includes(m));
      if (!metrics.length) continue;
      out.push({ id: b.id, type: "usage", provider: b.provider, theme: b.theme, metrics, ...look(cardStyles), ...layout });
    } else if (b.type === "calendar" && isProvider(b.provider) && isTheme(b.theme))
      out.push({ id: b.id, type: "calendar", provider: b.provider, theme: b.theme, ...look(calendarStyles), ...layout });
    else continue;
    seen.add(b.id);
  }
  return out;
}
