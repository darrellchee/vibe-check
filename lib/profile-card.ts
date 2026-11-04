import type { CardProvider, ModelUsage, UsageSnapshot } from "./types";
import { PROVIDERS, providerName } from "./providers";
import { modelLabel } from "./model-label";
import { storageProvider, type StorageProviderId } from "./storage-providers";

export type CardTheme = "dark" | "light";
// "cost" is the API-equivalent estimate in USD, never a subscription bill.
export type CardMetric = "tokens" | "sessions" | "requests" | "cost";
export const cardMetrics: CardMetric[] = ["tokens", "sessions", "requests", "cost"];
export const MAX_METRICS = 3;
// The All card can show every metric; a single harness's card shows up to three.
export const maxMetrics = (provider: CardProvider) => (provider === "all" ? cardMetrics.length : MAX_METRICS);
// "usage" is the summary card; "calendar" is a year of per-day activity levels; "trend" is daily usage
// as an area chart; "models" is each model's share of tokens; "ledger" is a table of models;
// "harnesses" is each harness's share of tokens (All only), as a bar graph or a pie chart.
export type CardKind = "usage" | "calendar" | "trend" | "models" | "ledger" | "harnesses";
export const cardKinds: CardKind[] = ["usage", "calendar", "trend", "models", "ledger", "harnesses"];
export type HarnessChart = "bar" | "pie";
export const harnessCharts: HarnessChart[] = ["bar", "pie"];
// The trend's window in days, and what it measures.
export type TrendDays = 30 | 90 | 365;
export const trendDays: TrendDays[] = [30, 90, 365];
export type TrendMeasure = "tokens" | "cost";
export const trendMeasures: TrendMeasure[] = ["tokens", "cost"];
// Layouts. Every kind has Classic plus its own set (see `stylesFor`); each layout draws the same data in
// a visibly different way. A card has a border (its background and outline) or none, in which case only
// the text (and a calendar's cells) show on whatever is behind it. Accents recolour a card; lime is the original.
export type CardStyle = "classic" | "compact" | "spotlight" | "tiles" | "list" | "bars" | "months" | "spark" | "donut" | "stacked";
// The usage card's layouts.
export const cardStyles: CardStyle[] = ["classic", "compact", "spotlight", "tiles", "list"];
export const calendarStyles: CardStyle[] = ["classic", "compact", "bars", "months"];
const KIND_STYLES: Record<CardKind, CardStyle[]> = {
  usage: cardStyles, calendar: calendarStyles, trend: ["classic", "compact", "bars", "spark"], models: ["classic", "compact", "donut", "list"],
  ledger: ["classic", "compact", "bars", "tiles"], harnesses: ["classic", "tiles", "stacked"],
};
export const allCardStyles = [...new Set(Object.values(KIND_STYLES).flat())];
export type CardBorder = "solid" | "none";
export const cardBorders: CardBorder[] = ["solid", "none"];
export type CardAccent = "lime" | "orange" | "blue" | "violet" | "mono";
export const cardAccents: CardAccent[] = ["lime", "orange", "blue", "violet", "mono"];
// Typography. A card is an SVG shown through <img> (on GitHub too), and images cannot load web fonts,
// so every option is a stack of fonts that ship with the viewer's system, ending in a generic family.
// A font that is not installed falls through to the next one, so a card always stays readable.
export type CardFont = "system" | "helvetica" | "geometric" | "humanist" | "verdana" | "rounded" | "serif" | "palatino"
  | "garamond" | "mono" | "typewriter" | "condensed" | "display" | "handwritten";
const FONT_STACKS: Record<CardFont, string> = {
  // The dashboard header's typeface (Inter) first. A card is an image and cannot load it, so a viewer without Inter installed falls back to their system font.
  system: "Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif",
  helvetica: "Helvetica Neue,Helvetica,Arial,Liberation Sans,sans-serif",
  geometric: "Avenir Next,Avenir,Century Gothic,Futura,Trebuchet MS,sans-serif",
  humanist: "Gill Sans,Gill Sans MT,Calibri,Optima,Trebuchet MS,sans-serif",
  verdana: "Verdana,Geneva,DejaVu Sans,sans-serif",
  rounded: "ui-rounded,SF Pro Rounded,Hiragino Maru Gothic ProN,Arial Rounded MT Bold,Nunito,Quicksand,sans-serif",
  serif: "Georgia,Times New Roman,Times,Liberation Serif,serif",
  palatino: "Palatino Linotype,Palatino,Book Antiqua,URW Palladio L,Georgia,serif",
  garamond: "Garamond,Baskerville,Baskerville Old Face,Hoefler Text,Georgia,serif",
  mono: "ui-monospace,SF Mono,Menlo,Consolas,DejaVu Sans Mono,Liberation Mono,monospace",
  typewriter: "American Typewriter,Courier New,Courier,Lucida Sans Typewriter,monospace",
  condensed: "Avenir Next Condensed,Arial Narrow,Roboto Condensed,Helvetica Neue Condensed,sans-serif",
  display: "Impact,Haettenschweiler,Arial Narrow Bold,Anton,sans-serif",
  handwritten: "Bradley Hand,Segoe Print,Marker Felt,Comic Sans MS,cursive",
};
export const cardFonts = Object.keys(FONT_STACKS) as CardFont[];
export const fontStack = (font: CardFont = "system") => FONT_STACKS[font];
// Motion. GitHub shows a card through <img>, which runs no scripts, so every effect is CSS inside the
// SVG itself: "fade" plays once as the card loads, "shimmer" and "pulse" loop. Viewers who ask their
// system for reduced motion get a still card.
export type CardAnimation = "none" | "fade" | "shimmer" | "pulse";
export const cardAnimations: CardAnimation[] = ["none", "fade", "shimmer", "pulse"];
// Owner-written text. A card's heading can be renamed, and a usage card's labels (the line under each
// figure); figures themselves never can. The text arrives in the image URL, so it is cleaned (control
// characters dropped, spaces collapsed), capped, and escaped wherever it is drawn.
export const TITLE_MAX = 32, LABEL_MAX = 20;
export const cleanCardText = (value: unknown, max: number) =>
  typeof value !== "string" ? "" : Array.from(value.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()).slice(0, max).join("").trim();
export type MetricLabels = Partial<Record<CardMetric, string>>;
export const DEFAULT_LABELS: Record<CardMetric, string> = { tokens: "RECORDED TOKENS", sessions: "SESSIONS", requests: "HUMAN REQUESTS", cost: "ESTIMATED COST" };
export interface CardLook { style?: CardStyle; accent?: CardAccent; font?: CardFont; border?: CardBorder; animation?: CardAnimation; title?: string; labels?: MetricLabels }
export interface TrendLook extends CardLook { days?: TrendDays; measure?: TrendMeasure }
export interface HarnessLook extends CardLook { chart?: HarnessChart }
// Each provider's accent matches its colour on the dashboard.
export const providerAccent: Record<CardProvider, CardAccent> = { all: "mono", codex: "lime", claude: "orange", cursor: "blue", antigravity: "violet" };
// The layouts each kind offers, Classic first. The harness card's Classic is a bar graph or a pie chart.
export const stylesFor = (kind: CardKind): CardStyle[] => KIND_STYLES[kind];

// Natural size of each card's SVG, so previews can reserve space and resize proportionally. Model
// cards grow with the number of rows, so they need the snapshot they will draw.
export function cardSize(kind: CardKind, style: CardStyle = "classic", snapshot?: UsageSnapshot | null, chart: HarnessChart = "bar") {
  const slim = style === "compact";
  if (kind === "harnesses") {
    const count = Math.max(1, snapshot ? harnessRows(snapshot).length : 1);
    if (style === "tiles") return { width: 560, height: 150 };
    if (style === "stacked") return { width: 560, height: 98 + Math.ceil(count / 2) * 24 };
    return { width: 560, height: chart === "pie" ? 196 : 64 + count * 32 };
  }
  if (kind === "calendar") return { width: 720, height: style === "bars" ? 150 : style === "months" ? 182 : slim ? 151 : 177 };
  if (kind === "trend") return { width: 720, height: slim || style === "spark" ? 132 : 196 };
  const rows = Math.max(1, snapshot ? modelRows(snapshot).length : 1);
  const mixRows = Math.max(1, snapshot ? modelRows(snapshot, MIX_TOP).length : 1);
  if (kind === "models") return { width: 560, height: style === "donut" ? 184 : style === "list" ? 54 + mixRows * 30 : slim ? 96 : 86 + Math.ceil(mixRows / 2) * 24 };
  if (kind === "ledger") return { width: 720, height: style === "bars" ? 60 + rows * 30 : style === "tiles" ? 60 + Math.ceil(rows / 3) * 82 : slim ? 70 + rows * 20 : 88 + rows * 26 };
  return { width: 560, height: slim ? 96 : style === "classic" ? 134 : 150 };
}

// Each harness's tokens, biggest first, in the colour the dashboard gives it.
const HARNESS_COLORS = ["#ff4901", "#2a78d6", "#1baf7a", "#eda100"];
export function harnessRows(snapshot: UsageSnapshot) {
  return (snapshot.harnesses ?? []).filter((h) => h.totalTokens > 0 && PROVIDERS.includes(h.provider))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .map((h) => ({ ...h, label: providerName(h.provider), color: HARNESS_COLORS[PROVIDERS.indexOf(h.provider)] }));
}

// The biggest models by tokens, then everything else as one "Other" row: six named rows in the ledger,
// five in the model mix so its two-column legend stays at six rows.
export const TOP_MODELS = 6, MIX_TOP = 5;
const MODEL_COLORS = ["#ff4901", "#2a78d6", "#1baf7a", "#eda100", "#e87ba4", "#008300"], OTHER_COLOR = "#8a8f94";
export interface ModelRow extends Omit<ModelUsage, "model"> { label: string; color: string }
export function modelRows(snapshot: UsageSnapshot, top = TOP_MODELS): ModelRow[] {
  if (snapshot.availability?.tokens === false) return [];
  const models = snapshot.models.filter((m) => m.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens);
  const row = ({ model, ...rest }: ModelUsage, i: number): ModelRow => ({ ...rest, label: modelLabel(model), color: MODEL_COLORS[i] });
  if (models.length <= top) return models.map(row);
  const rest = models.slice(top);
  const sum = (pick: (m: ModelUsage) => number) => rest.reduce((total, m) => total + pick(m), 0);
  return [...models.slice(0, top).map(row), {
    label: `Other (${rest.length})`, color: OTHER_COLOR, inputTokens: sum((m) => m.inputTokens), cachedInputTokens: sum((m) => m.cachedInputTokens),
    cacheWriteTokens: sum((m) => m.cacheWriteTokens), outputTokens: sum((m) => m.outputTokens), reasoningTokens: sum((m) => m.reasoningTokens),
    totalTokens: sum((m) => m.totalTokens), costUsd: sum((m) => m.costUsd), requests: sum((m) => m.requests),
    unpricedTokens: sum((m) => m.unpricedTokens), priced: rest.every((m) => m.priced),
  }];
}

interface Palette { bg: string; border: string; text: string; muted: string; accent: string; levels: string[] }
const PALETTES: Record<CardAccent, Record<CardTheme, Palette>> = {
  lime: {
    dark: { bg: "#1b1e18", border: "#3b4b2c", text: "#eef2e7", muted: "#a3b295", accent: "#b7ea76", levels: ["#2a3022", "#3b5a24", "#5d8f2e", "#8cc84b", "#b7ea76"] },
    light: { bg: "#fafbf7", border: "#d5ddcd", text: "#20291c", muted: "#526149", accent: "#426620", levels: ["#e6ebdf", "#c6e2a0", "#97c75a", "#5f9a2c", "#426620"] },
  },
  orange: {
    dark: { bg: "#1e1b17", border: "#4a3a2d", text: "#f0e9df", muted: "#b3a595", accent: "#e8a67b", levels: ["#2c2620", "#5a3d29", "#8a5a3a", "#c07c4e", "#e8a67b"] },
    light: { bg: "#fbf8f5", border: "#e3d6ca", text: "#2b2118", muted: "#7a6552", accent: "#b4571c", levels: ["#efe6dd", "#f1cfb2", "#e3a672", "#cc7a3a", "#a64e17"] },
  },
  blue: {
    dark: { bg: "#161b20", border: "#2d4256", text: "#e8f0f7", muted: "#94a9bb", accent: "#8ac5f7", levels: ["#222b33", "#25465f", "#2f6d9c", "#4f9fd9", "#8ac5f7"] },
    light: { bg: "#f6f9fc", border: "#cddbe8", text: "#16222d", muted: "#4d6377", accent: "#1f6fb0", levels: ["#e3ebf2", "#bcd8ef", "#86b9e0", "#4a90c9", "#1f6fb0"] },
  },
  violet: {
    dark: { bg: "#1a1720", border: "#3d3354", text: "#eee9f8", muted: "#a99bc4", accent: "#aa8af7", levels: ["#28232f", "#43356b", "#6a54b0", "#8c70e0", "#aa8af7"] },
    light: { bg: "#f9f7fd", border: "#d9d0ea", text: "#231c33", muted: "#65587f", accent: "#6c46c2", levels: ["#e9e4f3", "#d0c3ee", "#a995e0", "#8265d0", "#6c46c2"] },
  },
  mono: {
    dark: { bg: "#16181a", border: "#34383c", text: "#eceff1", muted: "#9aa2a8", accent: "#eceff1", levels: ["#24272a", "#3f4448", "#6a7075", "#9aa2a8", "#eceff1"] },
    light: { bg: "#fafafa", border: "#d9dce0", text: "#1d2023", muted: "#5a6168", accent: "#1d2023", levels: ["#e7e9eb", "#c3c8cc", "#9aa1a7", "#5f666c", "#1d2023"] },
  },
};

// The colour an accent is drawn in on a card of `theme`: bright on dark cards, deeper on light ones.
export const accentColor = (accent: CardAccent, theme: CardTheme) => PALETTES[accent][theme].accent;

// The "all harnesses" card is the personal headline; each harness card is titled after its dashboard.
export const defaultCardTitle = (provider: CardProvider) => (provider === "all" ? "MY TOTAL AI USAGE" : `${provider.toUpperCase()} USAGE`);
// The heading as drawn (escaped): the owner's own wording when there is one.
const cardTitle = (provider: CardProvider, custom?: string) => escapeXml(cleanCardText(custom, TITLE_MAX) || defaultCardTitle(provider));

const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (c) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
);

export function cardOptions(url: URL) {
  const theme = url.searchParams.get("theme") ?? "dark";
  const metrics = (url.searchParams.get("metrics") ?? "tokens,sessions").split(",");
  if (url.searchParams.getAll("theme").length > 1 || !["dark", "light"].includes(theme))
    throw new Error("Choose theme=dark or theme=light.");
  const limit = maxMetrics(url.searchParams.get("provider") === "all" ? "all" : "codex");
  if (url.searchParams.getAll("metrics").length > 1 || metrics.length > limit ||
    new Set(metrics).size !== metrics.length || metrics.some((m) => !cardMetrics.includes(m as CardMetric)))
    throw new Error(`Choose one to ${limit === 4 ? "four" : "three"} unique metrics: tokens,sessions,requests,cost.`);
  const kind = url.searchParams.get("kind") ?? "usage";
  if (url.searchParams.getAll("kind").length > 1 || !cardKinds.includes(kind as CardKind))
    throw new Error(`Choose kind=${cardKinds.join(", ")}.`);
  // style=transparent was a style before borders existed; links made then keep working as "no border".
  let style = url.searchParams.get("style") ?? "classic";
  const legacyClear = style === "transparent";
  if (legacyClear) style = kind === "calendar" ? "compact" : "classic";
  if (url.searchParams.getAll("style").length > 1 || !allCardStyles.includes(style as CardStyle))
    throw new Error(`Choose style=${allCardStyles.join(", ")}.`);
  if (!stylesFor(kind as CardKind).includes(style as CardStyle))
    throw new Error(`This card supports style=${stylesFor(kind as CardKind).join(", ")}.`);
  const days = Number(url.searchParams.get("days") ?? "90");
  if (url.searchParams.getAll("days").length > 1 || !trendDays.includes(days as TrendDays))
    throw new Error("Choose days=30, days=90 or days=365.");
  const chart = url.searchParams.get("chart") ?? "bar";
  if (url.searchParams.getAll("chart").length > 1 || !harnessCharts.includes(chart as HarnessChart))
    throw new Error("Choose chart=bar or chart=pie.");
  const measure = url.searchParams.get("measure") ?? "tokens";
  if (url.searchParams.getAll("measure").length > 1 || !trendMeasures.includes(measure as TrendMeasure))
    throw new Error("Choose measure=tokens or measure=cost.");
  const border = url.searchParams.get("border") ?? (legacyClear ? "none" : "solid");
  if (url.searchParams.getAll("border").length > 1 || !cardBorders.includes(border as CardBorder))
    throw new Error("Choose border=solid or border=none.");
  const accent = url.searchParams.get("accent") ?? "lime";
  if (url.searchParams.getAll("accent").length > 1 || !cardAccents.includes(accent as CardAccent))
    throw new Error("Choose accent=lime, orange, blue, violet or mono.");
  const font = url.searchParams.get("font") ?? "system";
  if (url.searchParams.getAll("font").length > 1 || !cardFonts.includes(font as CardFont))
    throw new Error(`Choose font=${cardFonts.join(", ")}.`);
  const title = url.searchParams.getAll("title");
  if (title.length > 1) throw new Error("Choose one title.");
  const labels: MetricLabels = {};
  for (const metric of cardMetrics) {
    const given = url.searchParams.getAll(`label-${metric}`);
    if (given.length > 1) throw new Error("Choose one label per metric.");
    const own = cleanCardText(given[0], LABEL_MAX);
    if (own) labels[metric] = own;
  }
  const animation = url.searchParams.get("animation") ?? "none";
  if (url.searchParams.getAll("animation").length > 1 || !cardAnimations.includes(animation as CardAnimation))
    throw new Error(`Choose animation=${cardAnimations.join(", ")}.`);
  return { kind: kind as CardKind, theme: theme as CardTheme, metrics: metrics as CardMetric[], style: style as CardStyle, accent: accent as CardAccent,
    font: font as CardFont, border: border as CardBorder, animation: animation as CardAnimation,
    title: cleanCardText(title[0], TITLE_MAX) || undefined, labels: Object.keys(labels).length ? labels : undefined,
    days: days as TrendDays, measure: measure as TrendMeasure, chart: chart as HarnessChart };
}

// Everything after a card's <desc>: its background (unless it has no border), the content, and what
// its animation needs. A card without animation is drawn exactly as before animations existed.
function cardLayers(width: number, height: number, colors: Palette, look: CardLook, body: string) {
  const motion = look.animation ?? "none";
  const frameClass = motion === "pulse" ? ' class="vc-frame"' : "", bodyClass = motion === "none" ? "" : ' class="vc-body"';
  const frame = look.border === "none" ? "" : `<rect${frameClass} x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="16" fill="${colors.bg}" stroke="${colors.border}"/>`;
  const content = `<g${bodyClass} font-family="${fontStack(look.font)}">${body}</g>`;
  if (motion === "none") return `${frame}${content}`;
  const still = "@media (prefers-reduced-motion:reduce){*{animation:none!important}}";
  if (motion === "fade") {
    // Each top-level piece rises in after the one before it: the title first, then the figures.
    const delays = Array.from({ length: 7 }, (_, i) => `.vc-body>:nth-child(${i + 2}){animation-delay:${(i + 1) * 0.1}s}`).join("");
    return `<style>.vc-body>*{animation:vc-in .7s cubic-bezier(.2,.7,.2,1) both}${delays}.vc-body>:nth-child(n+9){animation-delay:.8s}@keyframes vc-in{from{opacity:0;transform:translateY(8px)}}${still}</style>${frame}${content}`;
  }
  if (motion === "pulse") {
    // The outline glows in the accent colour and the title breathes with it.
    return `<style>.vc-frame{animation:vc-glow 2.8s ease-in-out infinite}.vc-body>:first-child{animation:vc-breathe 2.8s ease-in-out infinite}@keyframes vc-glow{50%{stroke:${colors.accent};stroke-width:2}}@keyframes vc-breathe{50%{opacity:.45}}${still}</style>${frame}${content}`;
  }
  // Shimmer: a band sweeps across, then rests before the next pass. Its strong part is a glint masked to
  // the content (a white copy of the text, numbers and graphics), so it lights only what is drawn. A
  // bordered card also gets a soft accent wash across the whole card, moving with the glint.
  const clear = look.border === "none";
  const band = Math.round(width * 0.3), travel = width + band + Math.round(height * 0.4);
  // The copy's ids are renamed so they don't clash with the content's own clip paths.
  const copy = body.replace(/id="([^"]+)"/g, 'id="vc-m-$1"').replace(/url\(#([^)]+)\)/g, "url(#vc-m-$1)");
  // The glint needs a bright core as well as accent edges: accent alone vanishes on accent-coloured lines
  // and titles, and the core alone vanishes on text of its own colour. Dark cards get a white core, light
  // cards a core of their (light) background.
  const core = parseInt(colors.bg.slice(1, 3), 16) < 128 ? "#ffffff" : colors.bg;
  const fade = (offset: number, color: string, opacity: number) => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`;
  const glint = fade(0, colors.accent, 0) + fade(0.3, colors.accent, 0.65) + fade(0.5, core, 0.85) + fade(0.7, colors.accent, 0.65) + fade(1, colors.accent, 0);
  const wash = fade(0, colors.accent, 0) + fade(0.5, colors.accent, 0.2) + fade(1, colors.accent, 0);
  const sweep = (fill: string) => `<g transform="skewX(-20)"><rect class="vc-shine" x="${-band}" y="0" width="${band}" height="${height}" fill="url(#${fill})"/></g>`;
  return `<style>.vc-shine{animation:vc-sweep 4s ease-in-out .4s infinite}@keyframes vc-sweep{0%{transform:translateX(0)}55%,100%{transform:translateX(${travel}px)}}` +
    `.vc-mask [fill]:not([fill=none]),.vc-mask text{fill:#fff}.vc-mask [stroke]:not([stroke=none]){stroke:#fff}${still}</style>` +
    `<defs><linearGradient id="vc-shine-glint" x1="0" x2="1">${glint}</linearGradient>` +
    `<mask id="vc-shine-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><g class="vc-mask" font-family="${fontStack(look.font)}">${copy}</g></mask>` +
    (clear ? "" : `<linearGradient id="vc-shine-wash" x1="0" x2="1">${wash}</linearGradient><clipPath id="vc-shine-clip"><rect width="${width}" height="${height}" rx="16"/></clipPath>`) +
    `</defs>${frame}${content}` +
    (clear ? "" : `<g clip-path="url(#vc-shine-clip)" pointer-events="none">${sweep("vc-shine-wash")}</g>`) +
    `<g mask="url(#vc-shine-mask)" pointer-events="none">${sweep("vc-shine-glint")}</g>`;
}

export function renderProfileCard(snapshot: UsageSnapshot, provider: CardProvider,
  theme: CardTheme, metrics: CardMetric[], look: CardLook = {}) {
  return drawUsage(snapshot, provider, theme, metrics, look).svg;
}

// Where each metric (its figure and label) sits on a usage card, in the SVG's own units, so the editor
// can put a drag target over each one. The layout is the same in both themes.
export interface MetricSlot { metric: CardMetric; x: number; y: number; width: number; height: number }
export function usageSlots(snapshot: UsageSnapshot, provider: CardProvider, metrics: CardMetric[], look: CardLook = {}) {
  const { slots } = drawUsage(snapshot, provider, "dark", metrics, look);
  return { ...cardSize("usage", look.style ?? "classic"), slots };
}

function drawUsage(snapshot: UsageSnapshot, provider: CardProvider, theme: CardTheme, metrics: CardMetric[], look: CardLook) {
  const colors = PALETTES[look.accent ?? "lime"][theme], style = look.style ?? "classic";
  const name = provider === "all" ? "All harnesses" : providerName(provider);
  const totals = { tokens: snapshot.totals.totalTokens, sessions: snapshot.totals.sessions, requests: snapshot.totals.humanRequests, cost: snapshot.totals.costUsd };
  const labels = { ...DEFAULT_LABELS };
  for (const metric of cardMetrics) { const own = cleanCardText(look.labels?.[metric], LABEL_MAX); if (own) labels[metric] = own; }
  const available = { tokens: snapshot.availability?.tokens !== false, sessions: snapshot.availability?.sessions !== false, requests: snapshot.availability?.humanRequests !== false, cost: snapshot.availability?.cost !== false };
  // No source model names, warnings, paths or usernames enter the SVG. The only text from the URL is the
  // owner's heading and labels, cleaned, capped and escaped.
  const updated = new Date(snapshot.generatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const value = (metric: CardMetric) => !available[metric] ? "Unavailable" : metric === "cost" ? `$${compact(totals.cost)}` : compact(totals[metric]);
  const summary = metrics.map((metric) => `${value(metric)} ${labels[metric].toLowerCase()}`).join(", ");
  const text = (x: number, y: number, fill: string, size: number, content: string, extra = "") =>
    `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}"${extra}>${content}</text>`;
  const heading = cardTitle(provider, look.title);
  // A label's type size: its usual size, or smaller when the owner's wording would overrun its room.
  const fit = (metric: CardMetric, room: number, base: number) => Math.max(6, Math.min(base, Math.floor((room / labels[metric].length - 1) / 0.7)));
  const { width, height } = cardSize("usage", style);
  // Pack metric columns by their (estimated) text width instead of spreading them across the card,
  // so a short column like SESSIONS doesn't leave a wide gap. Never placed further right than an even split.
  const columnXs = (valueSize: (metric: CardMetric) => number, labelSize: number, gap = 36) => {
    const xs: number[] = [];
    metrics.forEach((metric, i) => {
      const next = i === 0 ? 26 : xs[i - 1] + Math.max(
        value(metrics[i - 1]).length * 0.62 * valueSize(metrics[i - 1]),
        labels[metrics[i - 1]].length * (0.7 * labelSize + 1),
      ) + gap;
      xs.push(Math.round(Math.min(next, 26 + i * (508 / metrics.length))));
    });
    return xs;
  };
  // A box around a figure (baseline `valueY`, font `size`) and the label under it, with a little room.
  const slots: MetricSlot[] = [];
  const mark = (metric: CardMetric, x: number, valueY: number, size: number, labelY: number, labelSize: number, room = Infinity) => {
    const wide = Math.max(value(metric).length * 0.62 * size, labels[metric].length * (0.7 * labelSize + 1));
    const top = valueY - size * 0.78 - 6;
    slots.push({ metric, x: x - 8, y: Math.round(top), width: Math.round(Math.min(wide + 16, room)), height: Math.round(labelY + 6 - top) });
  };
  const four = metrics.length === 4;
  let body: string;
  if (style === "compact") {
    // One slim band: the title on top, every metric in a single row.
    const size = (metric: CardMetric) => !available[metric] ? (four ? 14 : 17) : four ? 20 : metrics.length === 3 ? 24 : 28, labelSize = four ? 8 : 9;
    const xs = columnXs(size, labelSize, four ? 24 : 36);
    const columns = metrics.map((metric, i) => {
      const x = xs[i];
      const room = (xs[i + 1] ?? 542) - x, small = fit(metric, room - 10, labelSize);
      mark(metric, x, 68, size(metric), 85, small, room);
      return text(x, 68, colors.text, size(metric), value(metric), ' font-weight="600"') +
        text(x, 85, colors.muted, small, escapeXml(labels[metric]), ' letter-spacing="1"');
    }).join("");
    body = text(26, 28, colors.accent, 11, heading, ' font-weight="600" letter-spacing="2"') + columns;
  } else if (style === "spotlight") {
    // The first metric is the hero; any others stack beside it.
    const [hero, ...rest] = metrics;
    // The last extra metric's label sits on the hero's label line; a second one stacks above it.
    // Three side figures (the All card's fourth metric) stack tighter, in smaller type.
    const side = rest.map((metric, i) => {
      const y = rest.length === 1 ? 100 : rest.length === 2 ? 53 + i * 50 : 50 + i * 38;
      const labelY = rest.length === 1 ? 122 : rest.length === 2 ? y + 19 : y + 12;
      const size = rest.length === 3 ? (!available[metric] ? 13 : 18) : !available[metric] ? 15 : 26, labelSize = rest.length === 3 ? 8 : 9;
      mark(metric, 350, y, size, labelY, labelSize);
      return text(350, y, colors.text, size, value(metric), ' font-weight="600"') +
        text(350, labelY, colors.muted, labelSize, escapeXml(labels[metric]), ' letter-spacing="1"');
    }).join("");
    mark(hero, 26, 100, !available[hero] ? 28 : 54, 122, 10);
    body = text(26, 35, colors.accent, 13, heading, ' font-weight="600" letter-spacing="2"') +
      text(26, 100, colors.text, !available[hero] ? 28 : 54, value(hero), ' font-weight="700"') +
      text(26, 122, colors.muted, fit(hero, 310, 10), escapeXml(labels[hero]), ' letter-spacing="1"') + side;
  } else if (style === "tiles") {
    // Each metric in its own panel, marked by a short accent bar.
    const gap = 10, w = (508 - gap * (metrics.length - 1)) / metrics.length;
    body = text(26, 35, colors.accent, 13, heading, ' font-weight="600" letter-spacing="2"') + metrics.map((metric, i) => {
      const x = Math.round(26 + i * (w + gap));
      slots.push({ metric, x, y: 52, width: Math.round(w), height: 76 });
      return `<g><rect x="${x}" y="52" width="${w.toFixed(1)}" height="76" rx="10" fill="${colors.levels[0]}"/>` +
        `<rect x="${x + 14}" y="64" width="22" height="3" rx="1.5" fill="${colors.accent}"/>` +
        text(x + 14, 98, colors.text, !available[metric] ? (four ? 13 : 15) : four ? 22 : metrics.length === 3 ? 24 : 30, value(metric), ' font-weight="600"') +
        text(x + 14, 116, colors.muted, fit(metric, w - 28, four ? 8 : 9), escapeXml(labels[metric]), ' letter-spacing="1"') + "</g>";
    }).join("");
  } else if (style === "list") {
    // A receipt: one metric per line, its label on the left, its figure on the right, a dotted leader between.
    body = text(26, 35, colors.accent, 13, heading, ' font-weight="600" letter-spacing="2"') + metrics.map((metric, i) => {
      // Four rows sit closer, so they still fit under the title.
      const step = four ? 25 : 32, y = Math.round((four ? 102 : 100) + (i - (metrics.length - 1) / 2) * step), size = !available[metric] ? 15 : four ? 18 : 20;
      const from = 36 + labels[metric].length * 8 + 10, to = 534 - value(metric).length * size * 0.6 - 10;
      slots.push({ metric, x: 18, y: Math.round(y - step * 0.68), width: 524, height: step - 2 });
      return `<g><rect x="26" y="${y - 10}" width="3" height="12" rx="1.5" fill="${colors.accent}"/>` +
        text(36, y, colors.muted, 10, escapeXml(labels[metric]), ' letter-spacing="1"') +
        (to > from ? `<line x1="${from}" y1="${y - 3.5}" x2="${to.toFixed(1)}" y2="${y - 3.5}" stroke="${colors.border}" stroke-dasharray="1 4" stroke-linecap="round"/>` : "") +
        text(534, y, colors.text, size, value(metric), ' font-weight="600" text-anchor="end"') + "</g>";
    }).join("");
  } else {
    // Even columns: the width split equally, each figure as big as its column allows (and smaller the
    // more metrics share the card), so a long figure shrinks instead of running into its neighbour.
    const col = 508 / metrics.length, base = [48, 46, 40, 34][metrics.length - 1], labelSize = four ? 9 : 10;
    const columns = metrics.map((metric, i) => {
      const x = Math.round(26 + i * col);
      const size = Math.floor(Math.min(available[metric] ? base : Math.min(base, 21), (col - 14) / (value(metric).length * 0.62)));
      const small = fit(metric, col - 14, labelSize);
      mark(metric, x, 86, size, 110, small, col);
      return text(x, 86, colors.text, size, value(metric), ' font-weight="600"') + text(x, 110, colors.muted, small, escapeXml(labels[metric]), ' letter-spacing="1"');
    }).join("");
    body = `<text x="26" y="35" fill="${colors.accent}" font-size="13" font-weight="600" letter-spacing="2">${heading}</text>${columns}`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(name)} usage</title><desc id="desc">${escapeXml(summary)}. Updated ${updated}. Available history, not verified account lifetime.</desc>${cardLayers(width, height, colors, look, body)}</svg>`;
  // In metric order, whatever order the layout drew them in (Spotlight draws its side figures first).
  slots.sort((a, b) => metrics.indexOf(a.metric) - metrics.indexOf(b.metric));
  return { svg, slots };
}

const DAY_MS = 86_400_000;
// Real calendar days only: 2026-02-30 and 2026-13-45 match the shape but are not dates.
const isCalendarDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A GitHub-style year of activity. Only per-day intensity levels, a total and a count of active
// days reach the SVG: no model names, project paths or exact daily figures.
export function renderActivityCalendar(snapshot: UsageSnapshot, provider: CardProvider, theme: CardTheme, look: CardLook = {}) {
  const colors = PALETTES[look.accent ?? "lime"][theme], style = look.style ?? "classic", slim = style === "compact";
  // The compact style drops the footer: just a header and the grid.
  const titleY = slim ? 26 : 35, gridY = slim ? 46 : 64;
  // 53 week columns span the card from the left margin to the right one (26 to 694, where the headline
  // ends). Cells stay square, five-sixths of a step wide, so the gaps scale with them.
  const step = 668 / (52 + 5 / 6), cell = step * 5 / 6, at = (n: number) => (26 + n * step).toFixed(1);
  const { width, height } = cardSize("calendar", style);
  const name = provider === "all" ? "All harnesses" : providerName(provider);
  // Tokens first, falling back to human requests when a source cannot report tokens. Cursor is the
  // exception (as on the dashboard): its token data only covers the exported or synced range, while
  // human requests span all retained history, so requests are preferred whenever they are recorded.
  const hasTokens = snapshot.availability?.tokens !== false, hasRequests = snapshot.availability?.humanRequests !== false;
  const measure: "tokens" | "requests" | null = provider === "cursor"
    ? (hasRequests ? "requests" : hasTokens ? "tokens" : null)
    : (hasTokens ? "tokens" : hasRequests ? "requests" : null);
  const generatedTime = new Date(snapshot.generatedAt).getTime();
  const generated = new Date(generatedTime).toISOString().slice(0, 10);
  // Timezones ahead of UTC can already be on the next calendar day; nothing later is plausible, so a
  // far-future row (for example 9999-12-31) can never move the window.
  const latest = new Date(generatedTime + DAY_MS).toISOString().slice(0, 10);
  const amounts = new Map<string, number>();
  for (const day of snapshot.daily) {
    if (measure && isCalendarDay(day.date) && day.date <= latest)
      amounts.set(day.date, measure === "tokens" ? day.totalTokens : day.humanRequests);
  }
  const end = Date.parse(`${[generated, ...amounts.keys()].sort().at(-1)}T00:00:00Z`);
  // 53 Sunday-first columns, the last holding the end date.
  const start = end - (52 * 7 + new Date(end).getUTCDay()) * DAY_MS;
  const cells: { col: number; row: number; value: number; month: number; date: string }[] = [];
  for (let col = 0; col < 53; col++) for (let row = 0; row < 7; row++) {
    const time = start + (col * 7 + row) * DAY_MS;
    if (time > end) break;
    const date = new Date(time).toISOString().slice(0, 10);
    cells.push({ col, row, value: amounts.get(date) ?? 0, month: new Date(time).getUTCMonth(), date });
  }
  const active = cells.filter((c) => c.value > 0).map((c) => c.value).sort((a, b) => a - b);
  const quantile = (p: number) => active[Math.floor(p * (active.length - 1))];
  const level = (v: number) => v <= 0 ? 0 : v <= quantile(0.25) ? 1 : v <= quantile(0.5) ? 2 : v <= quantile(0.75) ? 3 : 4;
  const total = active.reduce((sum, v) => sum + v, 0);
  const days = `${active.length} active ${active.length === 1 ? "day" : "days"}`;
  const summary = measure
    ? `${compact(total)} ${measure} across ${days} in the last 12 months`
    : "Daily activity unavailable";
  const rects = cells.map((c) =>
    `<rect x="${at(c.col)}" y="${(gridY + c.row * step).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="2" fill="${colors.levels[level(c.value)]}"/>`).join("");
  let previousMonth = -1;
  const labels = cells.filter((c) => c.row === 0 && c.col <= 50).flatMap((c) => {
    if (c.month === previousMonth) return [];
    previousMonth = c.month;
    return [{ col: c.col, month: c.month }];
  });
  // The first column's month is partial when the next month begins within two columns; its label
  // would overprint the next one, so it is left out.
  if (labels.length > 1 && labels[1].col - labels[0].col <= 2) labels.shift();
  const months = labels.map((l) =>
    `<text x="${at(l.col)}" y="${gridY - 8}" fill="${colors.muted}" font-size="9">${MONTHS[l.month]}</text>`).join("");
  const updated = new Date(snapshot.generatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const headline = measure ? `${compact(total)} ${measure} · ${days}` : "Unavailable";
  // Levels for a set of totals (weeks or months), by the same quartiles the day cells use.
  const leveller = (totals: number[]) => {
    const on = totals.filter((v) => v > 0).sort((a, b) => a - b), q = (p: number) => on[Math.floor(p * (on.length - 1))];
    return (v: number) => v <= 0 ? 0 : v <= q(0.25) ? 1 : v <= q(0.5) ? 2 : v <= q(0.75) ? 3 : 4;
  };
  let grid = `${months}${rects}`;
  if (style === "bars") {
    // One column per week, as tall as that week's total, under the same month labels.
    const weeks = Array.from({ length: 53 }, (_, col) => cells.filter((c) => c.col === col).reduce((sum, c) => sum + c.value, 0));
    const peak = Math.max(...weeks), weekLevel = leveller(weeks), top = 54, bottom = 120;
    const bars = weeks.map((v, col) => {
      const h = v > 0 && peak > 0 ? Math.max(3, (v / peak) * (bottom - top)) : 2;
      return `<rect x="${at(col)}" y="${(bottom - h).toFixed(1)}" width="${cell.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${colors.levels[v > 0 ? Math.max(2, weekLevel(v)) : 0]}"/>`;
    }).join("");
    grid = bars + labels.map((l) => `<text x="${at(l.col)}" y="138" fill="${colors.muted}" font-size="9">${MONTHS[l.month]}</text>`).join("");
  } else if (style === "months") {
    // The last twelve months as shaded tiles, each with its month and total.
    const last = new Date(end), totals = Array.from({ length: 12 }, (_, i) => {
      const at = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - 11 + i, 1)), key = at.toISOString().slice(0, 7);
      return { month: at.getUTCMonth(), total: cells.filter((c) => c.date.startsWith(key)).reduce((sum, c) => sum + c.value, 0) };
    });
    const monthLevel = leveller(totals.map((t) => t.total)), w = (668 - 5 * 8) / 6;
    grid = totals.map((t, i) => {
      const x = 26 + (i % 6) * (w + 8), y = 52 + Math.floor(i / 6) * 60, lvl = monthLevel(t.total), ink = lvl >= 3 ? colors.bg : colors.text;
      return `<g><rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="52" rx="8" fill="${colors.levels[lvl]}"/>` +
        `<text x="${(x + 12).toFixed(1)}" y="${y + 20}" fill="${ink}" font-size="10" letter-spacing="1" opacity="0.8">${MONTHS[t.month].toUpperCase()}</text>` +
        `<text x="${(x + 12).toFixed(1)}" y="${y + 40}" fill="${ink}" font-size="15" font-weight="600">${t.total > 0 ? compact(t.total) : "—"}</text></g>`;
    }).join("");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(name)} activity</title><desc id="desc">${escapeXml(summary)}. Updated ${updated}. Available history, not verified account lifetime.</desc>${cardLayers(width, height, colors, look, `<text x="26" y="${titleY}" fill="${colors.accent}" font-size="13" font-weight="600" letter-spacing="2">${cardTitle(provider, look.title)}</text><text x="694" y="${titleY}" fill="${colors.text}" font-size="13" font-weight="600" text-anchor="end">${escapeXml(headline)}</text>${grid}`)}</svg>`;
}

// The outer SVG every card shares: an accessible title and description, and the background unless
// the card has no border.
function cardFrame(width: number, height: number, title: string, summary: string, colors: Palette, look: CardLook, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(summary)}.</desc>${cardLayers(width, height, colors, look, body)}</svg>`;
}
const cardName = (provider: CardProvider) => (provider === "all" ? "All harnesses" : providerName(provider));
// `heading` is already escaped (see `cardTitle`).
const titleText = (heading: string, y: number, colors: Palette, size = 13) =>
  `<text x="26" y="${y}" fill="${colors.accent}" font-size="${size}" font-weight="600" letter-spacing="2">${heading}</text>`;
const headlineText = (x: number, y: number, colors: Palette, content: string, size = 13) =>
  `<text x="${x}" y="${y}" fill="${colors.text}" font-size="${size}" font-weight="600" text-anchor="end">${escapeXml(content)}</text>`;
// Cut a label to `max` characters, ending in an ellipsis when it was longer.
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const shortDate = (time: number) => `${MONTHS[new Date(time).getUTCMonth()]} ${new Date(time).getUTCDate()}`;
// Cents only for small amounts; whole dollars up to $1,000; then 1.2K style.
const usd = (n: number) => `$${n > 0 && n < 10 ? n.toFixed(2) : n < 1000 ? Math.round(n) : compact(n)}`;

// Daily usage over the last 30, 90 or 365 days as an area chart. Tokens fall back to human requests
// when a source cannot report tokens; cost has no fallback.
export function renderTrendChart(snapshot: UsageSnapshot, provider: CardProvider, theme: CardTheme, look: TrendLook = {}) {
  const colors = PALETTES[look.accent ?? "lime"][theme], style = look.style ?? "classic", slim = style === "compact";
  const days = look.days ?? 90, wanted = look.measure ?? "tokens";
  const measure: "tokens" | "requests" | "cost" | null = wanted === "cost"
    ? (snapshot.availability?.cost !== false ? "cost" : null)
    : snapshot.availability?.tokens !== false ? "tokens" : snapshot.availability?.humanRequests !== false ? "requests" : null;
  const { width, height } = cardSize("trend", style);
  const titleY = slim ? 28 : 35, top = slim ? 50 : 66, bottom = slim ? 112 : 160, left = 26, right = 694;
  // Same end date as the calendar: today, or a later recorded day in a timezone ahead of UTC.
  const generatedTime = new Date(snapshot.generatedAt).getTime();
  const latest = new Date(generatedTime + DAY_MS).toISOString().slice(0, 10);
  const amounts = new Map<string, number>();
  for (const day of snapshot.daily) {
    if (!measure || !isCalendarDay(day.date) || day.date > latest) continue;
    amounts.set(day.date, measure === "tokens" ? day.totalTokens : measure === "requests" ? day.humanRequests : day.costUsd);
  }
  const end = Date.parse(`${[new Date(generatedTime).toISOString().slice(0, 10), ...amounts.keys()].sort().at(-1)}T00:00:00Z`);
  const start = end - (days - 1) * DAY_MS;
  const values = Array.from({ length: days }, (_, i) => Math.max(0, amounts.get(new Date(start + i * DAY_MS).toISOString().slice(0, 10)) ?? 0));
  const total = values.reduce((sum, v) => sum + v, 0), peak = Math.max(...values);
  const range = days === 365 ? "12 months" : `${days} days`;
  const format = (n: number) => (measure === "cost" ? usd(n) : compact(n));
  const headline = !measure ? "Unavailable" : `${format(total)}${measure === "cost" ? "" : ` ${measure}`} · ${range}`;
  const x = (i: number) => (left + (i * (right - left)) / (days - 1)).toFixed(1);
  const y = (v: number) => (peak > 0 ? bottom - (v / peak) * (bottom - top) : bottom).toFixed(1);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join("");
  const summary = measure ? `${headline}, from ${shortDate(start)} to ${shortDate(end)}` : "Daily usage unavailable";
  if (style === "spark") {
    // The total as a big figure, with a bare line of the days beside it ending in a dot on the latest day.
    const sl = 300, sr = right, st = 46, sb = 104;
    const sx = (i: number) => (sl + (i * (sr - sl)) / (days - 1)).toFixed(1);
    const sy = (v: number) => (peak > 0 ? sb - (v / peak) * (sb - st) : sb).toFixed(1);
    const spark = measure
      ? `<g><line x1="${sl}" y1="${sb + 0.5}" x2="${sr}" y2="${sb + 0.5}" stroke="${colors.border}" stroke-dasharray="2 4"/>` +
        `<path d="${values.map((v, i) => `${i ? "L" : "M"}${sx(i)} ${sy(v)}`).join("")}" fill="none" stroke="${colors.accent}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${sr}" cy="${sy(values[days - 1])}" r="7" fill="${colors.accent}" fill-opacity="0.25"/><circle cx="${sr}" cy="${sy(values[days - 1])}" r="3.5" fill="${colors.accent}"/></g>`
      : "";
    const unit = measure === "cost" ? "ESTIMATED COST" : measure ? `${measure.toUpperCase()}` : "";
    return cardFrame(width, height, `${cardName(provider)} usage trend`, summary, colors, look,
      titleText(cardTitle(provider, look.title), 30, colors, 11) +
      `<text x="26" y="${measure ? 84 : 80}" fill="${colors.text}" font-size="${measure ? 38 : 20}" font-weight="700">${measure ? escapeXml(format(total)) : "Unavailable"}</text>` +
      (measure ? `<text x="26" y="106" fill="${colors.muted}" font-size="9" letter-spacing="1">${unit} · LAST ${range.toUpperCase()}</text>` : "") + spark);
  }
  const chart = !measure ? "" : style === "bars"
    // One column per day.
    ? `<g fill="${colors.accent}">${values.map((v, i) => {
      const step = (right - left) / days, h = peak > 0 ? (v / peak) * (bottom - top) : 0;
      return h > 0 ? `<rect x="${(left + i * step).toFixed(1)}" y="${(bottom - h).toFixed(1)}" width="${Math.max(0.8, step * 0.72).toFixed(2)}" height="${h.toFixed(1)}" rx="${step > 4 ? 1.5 : 0}"/>` : "";
    }).join("")}</g>`
    : `<path d="${line}L${right} ${bottom}L${left} ${bottom}Z" fill="${colors.accent}" fill-opacity="0.18"/><path d="${line}" fill="none" stroke="${colors.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const baseline = `<line x1="${left}" y1="${bottom + 0.5}" x2="${right}" y2="${bottom + 0.5}" stroke="${colors.border}"/>`;
  const axis = slim ? "" :
    `<line x1="${left}" y1="${top - 0.5}" x2="${right}" y2="${top - 0.5}" stroke="${colors.border}" stroke-dasharray="3 4"/>` +
    (measure && peak > 0 ? `<text x="${right}" y="${top - 6}" fill="${colors.muted}" font-size="9" text-anchor="end">${escapeXml(format(peak))}</text>` : "") +
    [[start, "start", left], [start + Math.floor(days / 2) * DAY_MS, "middle", (left + right) / 2], [end, "end", right]]
      .map(([time, anchor, at]) => `<text x="${at}" y="${bottom + 20}" fill="${colors.muted}" font-size="9" text-anchor="${anchor}">${shortDate(time as number)}</text>`).join("");
  return cardFrame(width, height, `${cardName(provider)} usage trend`, summary, colors, look,
    titleText(cardTitle(provider, look.title), titleY, colors, slim ? 11 : 13) + headlineText(right, titleY, colors, headline, slim ? 11 : 13) + baseline + axis + chart);
}

// Each model's share of recorded tokens: a stacked bar with a legend. The five biggest models are
// named and the rest share one "Other" row.
export function renderModelMix(snapshot: UsageSnapshot, provider: CardProvider, theme: CardTheme, look: CardLook = {}) {
  const colors = PALETTES[look.accent ?? "lime"][theme], style = look.style ?? "classic", slim = style === "compact";
  const rows = modelRows(snapshot, MIX_TOP), total = rows.reduce((sum, r) => sum + r.totalTokens, 0);
  const { width, height } = cardSize("models", style, snapshot);
  const titleY = slim ? 28 : 35, barY = slim ? 42 : 52, barH = slim ? 10 : 12, left = 26, span = 508;
  const share = (n: number) => {
    const pct = total ? (n / total) * 100 : 0;
    return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  };
  let at = left;
  const segments = rows.map((r) => {
    const w = (r.totalTokens / total) * span, rect = `<rect x="${at.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" fill="${r.color}"/>`;
    at += w;
    return rect;
  }).join("");
  const bar = rows.length
    ? `<clipPath id="bar"><rect x="${left}" y="${barY}" width="${span}" height="${barH}" rx="${barH / 2}"/></clipPath><g clip-path="url(#bar)">${segments}</g>`
    : `<rect x="${left}" y="${barY}" width="${span}" height="${barH}" rx="${barH / 2}" fill="${colors.levels[0]}"/>`;
  const item = (r: ModelRow, x: number, y: number, room: number, chars: number) =>
    `<rect x="${x}" y="${y - 9}" width="9" height="9" rx="2" fill="${r.color}"/>` +
    `<text x="${x + 15}" y="${y}" fill="${colors.text}" font-size="12">${escapeXml(clip(r.label, chars))}</text>` +
    `<text x="${x + room}" y="${y}" fill="${colors.muted}" font-size="12" text-anchor="end">${share(r.totalTokens)}</text>`;
  const legend = !rows.length
    ? `<text x="${left}" y="${slim ? 78 : 92}" fill="${colors.muted}" font-size="12">No model usage recorded</text>`
    : slim
      ? rows.slice(0, 3).map((r, i) => item(r, left + i * 172, 78, 160, 17)).join("")
      : rows.map((r, i) => item(r, left + (i % 2) * 260, 92 + Math.floor(i / 2) * 24, 236, 28)).join("");
  const headline = rows.length ? `${compact(total)} tokens` : "Unavailable";
  const summary = rows.length ? rows.map((r) => `${r.label} ${share(r.totalTokens)}`).join(", ") : "No model usage recorded";
  if (style === "donut") {
    // A ring split by model with the total in its hole, and a legend beside it.
    const cx = 100, cy = 106, radius = 50, ring = 2 * Math.PI * radius;
    let done = 0;
    const arcs = rows.map((r) => {
      const length = (r.totalTokens / total) * ring, arc = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${r.color}" stroke-width="20" stroke-dasharray="${length.toFixed(2)} ${ring.toFixed(2)}" stroke-dashoffset="${(-done).toFixed(2)}"/>`;
      done += length;
      return arc;
    }).join("");
    // The ring is rotated to start at 12 o'clock; it sits in its own group so animations can move the group.
    const donut = `<g><g transform="rotate(-90 ${cx} ${cy})"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${colors.levels[0]}" stroke-width="20"/>${arcs}</g>` +
      `<text x="${cx}" y="${cy + 3}" fill="${colors.text}" font-size="17" font-weight="700" text-anchor="middle">${rows.length ? compact(total) : "—"}</text>` +
      `<text x="${cx}" y="${cy + 17}" fill="${colors.muted}" font-size="8" letter-spacing="1" text-anchor="middle">TOKENS</text></g>`;
    const first = cy - (rows.length - 1) * 11 + 4;
    const key = !rows.length
      ? `<text x="200" y="${cy + 4}" fill="${colors.muted}" font-size="12">No model usage recorded</text>`
      : rows.map((r, i) => item(r, 200, first + i * 22, 334, 34)).join("");
    return cardFrame(width, height, `${cardName(provider)} model mix`, summary, colors, look, titleText(cardTitle(provider, look.title), 35, colors) + donut + key);
  }
  if (style === "list") {
    // A row per model: its name, its own bar against the full width, and its share.
    const list = !rows.length
      ? `<text x="26" y="66" fill="${colors.muted}" font-size="12">No model usage recorded</text>`
      : rows.map((r, i) => {
        const y = 66 + i * 30, w = Math.max(3, (r.totalTokens / total) * 290);
        return `<g><text x="26" y="${y}" fill="${colors.text}" font-size="12">${escapeXml(clip(r.label, 20))}</text>` +
          `<rect x="186" y="${y - 9}" width="290" height="10" rx="5" fill="${colors.levels[0]}"/>` +
          `<rect x="186" y="${y - 9}" width="${w.toFixed(1)}" height="10" rx="5" fill="${r.color}"/>` +
          `<text x="534" y="${y}" fill="${colors.text}" font-size="12" font-weight="600" text-anchor="end">${share(r.totalTokens)}</text></g>`;
      }).join("");
    return cardFrame(width, height, `${cardName(provider)} model mix`, summary, colors, look,
      titleText(cardTitle(provider, look.title), 35, colors) + headlineText(534, 35, colors, headline) + list);
  }
  return cardFrame(width, height, `${cardName(provider)} model mix`, summary, colors, look,
    titleText(cardTitle(provider, look.title), titleY, colors, slim ? 11 : 13) + headlineText(534, titleY, colors, headline, slim ? 11 : 13) + bar + legend);
}

// Tokens and estimated cost per model, as a table. Same rows as the model mix.
export function renderModelLedger(snapshot: UsageSnapshot, provider: CardProvider, theme: CardTheme, look: CardLook = {}) {
  const colors = PALETTES[look.accent ?? "lime"][theme], style = look.style ?? "classic", slim = style === "compact";
  const rows = modelRows(snapshot);
  const { width, height } = cardSize("ledger", style, snapshot);
  const hasCost = snapshot.availability?.cost !== false, hasCache = snapshot.availability?.cacheBreakdown !== false;
  const cost = (r: ModelRow) => (!hasCost || (!r.priced && r.costUsd <= 0) ? "—" : `${usd(r.costUsd)}${r.priced ? "" : "+"}`);
  const columns: { label: string; x: number; value: (r: ModelRow) => string }[] = slim
    ? [{ label: "TOKENS", x: 580, value: (r) => compact(r.totalTokens) }, { label: "COST", x: 694, value: cost }]
    : [
      { label: "INPUT", x: 420, value: (r) => compact(r.inputTokens) },
      { label: "CACHED", x: 510, value: (r) => (hasCache ? compact(r.cachedInputTokens) : "—") },
      { label: "OUTPUT", x: 600, value: (r) => compact(r.outputTokens) },
      { label: "COST", x: 694, value: cost },
    ];
  const titleY = slim ? 28 : 35, headY = slim ? 52 : 66, firstY = slim ? 72 : 92, step = slim ? 20 : 26, size = slim ? 12 : 13;
  const head = `<text x="26" y="${headY}" fill="${colors.muted}" font-size="9" letter-spacing="1">MODEL</text>` +
    columns.map((c) => `<text x="${c.x}" y="${headY}" fill="${colors.muted}" font-size="9" letter-spacing="1" text-anchor="end">${c.label}</text>`).join("");
  const body = !rows.length
    ? `<text x="26" y="${firstY}" fill="${colors.muted}" font-size="${size}">No model usage recorded</text>`
    : rows.map((r, i) => {
      const y = firstY + i * step;
      const rule = i ? `<line x1="26" y1="${y - step + 7.5}" x2="694" y2="${y - step + 7.5}" stroke="${colors.border}" stroke-opacity="0.6"/>` : "";
      return rule + `<rect x="26" y="${y - 9}" width="9" height="9" rx="2" fill="${r.color}"/>` +
        `<text x="41" y="${y}" fill="${colors.text}" font-size="${size}">${escapeXml(clip(r.label, slim ? 40 : 34))}</text>` +
        columns.map((c) => `<text x="${c.x}" y="${y}" fill="${colors.text}" font-size="${size}" text-anchor="end">${escapeXml(c.value(r))}</text>`).join("");
    }).join("");
  const count = rows.length ? snapshot.models.filter((m) => m.totalTokens > 0).length : 0;
  const headline = count ? `${count} ${count === 1 ? "model" : "models"}` : "Unavailable";
  const summary = rows.length ? rows.map((r) => `${r.label}: ${compact(r.totalTokens)} tokens, ${cost(r)}`).join("; ") : "No model usage recorded";
  const empty = `<text x="26" y="70" fill="${colors.muted}" font-size="13">No model usage recorded</text>`;
  if (style === "bars") {
    // A leaderboard: rank, model, a bar against the biggest model, then tokens and cost.
    const most = Math.max(1, ...rows.map((r) => r.totalTokens));
    const board = !rows.length ? empty : rows.map((r, i) => {
      const y = 70 + i * 30, w = Math.max(3, (r.totalTokens / most) * 250);
      return `<g><text x="26" y="${y}" fill="${colors.muted}" font-size="11" font-weight="600">${String(i + 1).padStart(2, "0")}</text>` +
        `<text x="52" y="${y}" fill="${colors.text}" font-size="13">${escapeXml(clip(r.label, 30))}</text>` +
        `<rect x="296" y="${y - 9}" width="${w.toFixed(1)}" height="10" rx="5" fill="${r.color}"/>` +
        `<text x="630" y="${y}" fill="${colors.text}" font-size="13" font-weight="600" text-anchor="end">${compact(r.totalTokens)}</text>` +
        `<text x="694" y="${y}" fill="${colors.muted}" font-size="12" text-anchor="end">${escapeXml(cost(r))}</text></g>`;
    }).join("");
    return cardFrame(width, height, `${cardName(provider)} model ledger`, summary, colors, look,
      titleText(cardTitle(provider, look.title), 35, colors) + headlineText(694, 35, colors, headline) + board);
  }
  if (style === "tiles") {
    // A panel per model, three to a row: its colour, name, tokens and cost.
    const w = (668 - 2 * 10) / 3;
    const panels = !rows.length ? empty : rows.map((r, i) => {
      const x = 26 + (i % 3) * (w + 10), y = 52 + Math.floor(i / 3) * 82;
      return `<g><rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="72" rx="10" fill="${colors.levels[0]}"/>` +
        `<rect x="${(x + 14).toFixed(1)}" y="${y + 15}" width="8" height="8" rx="2" fill="${r.color}"/>` +
        `<text x="${(x + 28).toFixed(1)}" y="${y + 23}" fill="${colors.muted}" font-size="11">${escapeXml(clip(r.label, 26))}</text>` +
        `<text x="${(x + 14).toFixed(1)}" y="${y + 54}" fill="${colors.text}" font-size="22" font-weight="700">${compact(r.totalTokens)}</text>` +
        `<text x="${(x + w - 14).toFixed(1)}" y="${y + 54}" fill="${colors.muted}" font-size="12" text-anchor="end">${escapeXml(cost(r))}</text></g>`;
    }).join("");
    return cardFrame(width, height, `${cardName(provider)} model ledger`, summary, colors, look,
      titleText(cardTitle(provider, look.title), 35, colors) + headlineText(694, 35, colors, headline) + panels);
  }
  return cardFrame(width, height, `${cardName(provider)} model ledger`, summary, colors, look,
    titleText(cardTitle(provider, look.title), titleY, colors, slim ? 11 : 13) + headlineText(694, titleY, colors, headline, slim ? 11 : 13) + head + body);
}

// Each harness's share of recorded tokens, from a combined (All) snapshot. The bar variant gives each
// harness a row; the pie variant draws slices with a legend beside them.
export function renderHarnessShare(snapshot: UsageSnapshot, provider: CardProvider, theme: CardTheme, look: HarnessLook = {}) {
  const colors = PALETTES[look.accent ?? "lime"][theme], style = look.style ?? "classic", pie = style === "classic" && look.chart === "pie";
  const rows = harnessRows(snapshot), total = rows.reduce((sum, r) => sum + r.totalTokens, 0);
  const { width, height } = cardSize("harnesses", style, snapshot, pie ? "pie" : "bar");
  const share = (n: number) => {
    const pct = total ? (n / total) * 100 : 0;
    return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  };
  const figures = (r: (typeof rows)[number], y: number) =>
    `<text x="470" y="${y}" fill="${colors.muted}" font-size="12" text-anchor="end">${compact(r.totalTokens)}</text>` +
    `<text x="534" y="${y}" fill="${colors.text}" font-size="13" font-weight="600" text-anchor="end">${share(r.totalTokens)}</text>`;
  let body: string;
  if (!rows.length) body = `<text x="26" y="${pie ? 110 : 76}" fill="${colors.muted}" font-size="12">No harness usage recorded</text>`;
  else if (style === "tiles") {
    // A panel per harness, side by side: its colour, name, share and tokens.
    const w = (508 - 10 * (rows.length - 1)) / rows.length;
    body = rows.map((r, i) => {
      const x = 26 + i * (w + 10);
      return `<g><rect x="${x.toFixed(1)}" y="52" width="${w.toFixed(1)}" height="76" rx="10" fill="${colors.levels[0]}"/>` +
        `<rect x="${(x + 14).toFixed(1)}" y="64" width="22" height="4" rx="2" fill="${r.color}"/>` +
        `<text x="${(x + 14).toFixed(1)}" y="86" fill="${colors.muted}" font-size="11">${escapeXml(r.label)}</text>` +
        `<text x="${(x + 14).toFixed(1)}" y="116" fill="${colors.text}" font-size="${rows.length > 3 ? 22 : 26}" font-weight="700">${share(r.totalTokens)}</text>` +
        `<text x="${(x + w - 14).toFixed(1)}" y="116" fill="${colors.muted}" font-size="10" text-anchor="end">${compact(r.totalTokens)}</text></g>`;
    }).join("");
  } else if (style === "stacked") {
    // One thick bar split by harness, shares printed inside wide enough parts, and a legend below.
    let at = 26;
    const parts = rows.map((r) => {
      const w = (r.totalTokens / total) * 508, x = at;
      at += w;
      return `<rect x="${x.toFixed(1)}" y="52" width="${w.toFixed(1)}" height="28" fill="${r.color}"/>` +
        (w > 40 ? `<text x="${(x + 10).toFixed(1)}" y="70" fill="#ffffff" font-size="11" font-weight="700">${share(r.totalTokens)}</text>` : "");
    }).join("");
    const legend = rows.map((r, i) => {
      const x = 26 + (i % 2) * 260, y = 110 + Math.floor(i / 2) * 24;
      return `<rect x="${x}" y="${y - 9}" width="9" height="9" rx="2" fill="${r.color}"/>` +
        `<text x="${x + 15}" y="${y}" fill="${colors.text}" font-size="12">${escapeXml(r.label)}</text>` +
        `<text x="${x + 236}" y="${y}" fill="${colors.muted}" font-size="12" text-anchor="end">${compact(r.totalTokens)}</text>`;
    }).join("");
    body = `<clipPath id="hbar"><rect x="26" y="52" width="508" height="28" rx="8"/></clipPath><g clip-path="url(#hbar)">${parts}</g>${legend}`;
  } else if (pie) {
    // A thick ring split by harness, starting at 12 o'clock and running clockwise. Slices are separated
    // by an even 3px gap, so the card background shows through on any theme or border.
    const cx = 100, cy = 116, outer = 64, inner = 40, gap = 1.5, TAU = Math.PI * 2, MIN = 0.09;
    // A sliver under ~5° would vanish behind the gaps, so it is widened and the rest shrink to make room.
    const raw = rows.map((r) => (r.totalTokens / total) * TAU);
    const tiny = raw.filter((s) => s < MIN), big = raw.filter((s) => s >= MIN).reduce((a, b) => a + b, 0);
    const scale = big ? (TAU - tiny.length * MIN) / big : 1;
    const sweeps = raw.map((s) => (s < MIN ? MIN : s * scale));
    const at = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
    let angle = 0;
    const slices = rows.length === 1
      ? `<circle cx="${cx}" cy="${cy}" r="${(outer + inner) / 2}" fill="none" stroke="${rows[0].color}" stroke-width="${outer - inner}"/>`
      : rows.map((r, i) => {
        const from = angle, to = (angle += sweeps[i]), po = gap / outer, pi = gap / inner;
        const large = to - from - 2 * po > Math.PI ? 1 : 0;
        return `<path d="M${at(outer, from + po)}A${outer} ${outer} 0 ${large} 1 ${at(outer, to - po)}` +
          `L${at(inner, to - pi)}A${inner} ${inner} 0 ${large} 0 ${at(inner, from + pi)}Z" fill="${r.color}"/>`;
      }).join("");
    const first = cy - (rows.length - 1) * 14 + 4;
    const legend = rows.map((r, i) => {
      const y = first + i * 28;
      return `<g><rect x="210" y="${y - 9}" width="9" height="9" rx="2" fill="${r.color}"/>` +
        `<text x="226" y="${y}" fill="${colors.text}" font-size="13">${escapeXml(r.label)}</text>` + figures(r, y) + `</g>`;
    }).join("");
    // The ring sits in one group so the rise-in animation moves it as a whole, then each legend row follows.
    body = `<g>${slices}</g>` + legend;
  } else {
    body = rows.map((r, i) => {
      const y = 76 + i * 32, w = Math.max(2, (r.totalTokens / total) * 260);
      return `<text x="26" y="${y}" fill="${colors.text}" font-size="13">${escapeXml(r.label)}</text>` +
        `<rect x="140" y="${y - 10}" width="260" height="12" rx="6" fill="${colors.levels[0]}"/>` +
        `<rect x="140" y="${y - 10}" width="${w.toFixed(1)}" height="12" rx="6" fill="${r.color}"/>` + figures(r, y);
    }).join("");
  }
  const headline = rows.length ? `${compact(total)} tokens` : "Unavailable";
  const summary = rows.length ? rows.map((r) => `${r.label} ${share(r.totalTokens)}`).join(", ") : "No harness usage recorded";
  return cardFrame(width, height, `${cardName(provider)} usage by harness`, summary, colors, look,
    titleText(cardTitle(provider, look.title), 35, colors) + headlineText(534, 35, colors, headline) + body);
}

// Any card kind, drawn with its options. The public endpoint, the editor and the preview all draw through this.
export interface CardRequest extends TrendLook { kind: CardKind; metrics?: CardMetric[]; chart?: HarnessChart }
export function renderCard(snapshot: UsageSnapshot, provider: CardProvider, theme: CardTheme, request: CardRequest) {
  const { kind, metrics, days, measure, chart, ...look } = request;
  switch (kind) {
    case "calendar": return renderActivityCalendar(snapshot, provider, theme, look);
    case "trend": return renderTrendChart(snapshot, provider, theme, { ...look, days, measure });
    case "models": return renderModelMix(snapshot, provider, theme, look);
    case "ledger": return renderModelLedger(snapshot, provider, theme, look);
    case "harnesses": return renderHarnessShare(snapshot, provider, theme, { ...look, chart });
    default: return renderProfileCard(snapshot, provider, theme, metrics ?? ["tokens", "sessions"], look);
  }
}

const ORIGIN_HELP = "Enter a full https:// address, for example https://your-instance.vercel.app";
const PRIVATE_HOST = "GitHub cannot load images from private or local addresses. Use your public deployment address.";

// Hosts GitHub's image proxy can never reach: loopback and private ranges, link-local, carrier-grade
// NAT, local-only names, and bare single-label names. IPv6 literals are refused outright.
function unreachableHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (!host.includes(".")) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!octets) return false;
  const [a, b] = [Number(octets[1]), Number(octets[2])];
  return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function cardUrl(origin: string) {
  let base: URL;
  try { base = new URL(origin); } catch { throw new Error(ORIGIN_HELP); }
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw new Error("Enter your public HTTPS dashboard origin, without a path or credentials.");
  if (unreachableHost(base.hostname)) throw new Error(PRIVATE_HOST);
  return new URL("/api/card", base);
}
const markdownSafe = (url: URL) => url.href.replace(/\(/g, "%28").replace(/\)/g, "%29");

// Defaults stay out of the URL, so embeds made before styles existed are unchanged.
function setLook(image: URL, look: CardLook) {
  if (look.style && look.style !== "classic") image.searchParams.set("style", look.style);
  if (look.accent && look.accent !== "lime") image.searchParams.set("accent", look.accent);
  if (look.font && look.font !== "system") image.searchParams.set("font", look.font);
  if (look.animation && look.animation !== "none") image.searchParams.set("animation", look.animation);
  const title = cleanCardText(look.title, TITLE_MAX);
  if (title) image.searchParams.set("title", title);
  if (look.border === "none") image.searchParams.set("border", "none");
}

const EMBED_ALT: Record<CardKind, [string, string]> = {
  usage: ["My recorded AI coding usage", "usage"], calendar: ["My recorded AI coding activity", "activity"],
  trend: ["My daily AI coding usage", "daily usage"], models: ["The AI models I use", "model mix"], ledger: ["My AI model ledger", "model ledger"],
  harnesses: ["My AI coding usage by harness", "usage by harness"],
};
// The image URL and alt text for any card. Defaults stay out of the URL.
export function widgetEmbed(origin: string, provider: CardProvider, theme: CardTheme, request: CardRequest) {
  const image = cardUrl(origin);
  if (request.kind !== "usage") image.searchParams.set("kind", request.kind);
  image.searchParams.set("provider", provider);
  image.searchParams.set("theme", theme);
  if (request.kind === "usage") {
    const metrics = request.metrics ?? ["tokens", "sessions"];
    image.searchParams.set("metrics", metrics.join(","));
    // Only the labels of metrics the card shows travel in the URL.
    for (const metric of metrics) {
      const own = cleanCardText(request.labels?.[metric], LABEL_MAX);
      if (own && own !== DEFAULT_LABELS[metric]) image.searchParams.set(`label-${metric}`, own);
    }
  }
  if (request.kind === "trend" && request.days && request.days !== 90) image.searchParams.set("days", String(request.days));
  if (request.kind === "trend" && request.measure === "cost") image.searchParams.set("measure", "cost");
  if (request.kind === "harnesses" && request.chart === "pie") image.searchParams.set("chart", "pie");
  setLook(image, request);
  const imageUrl = markdownSafe(image);
  const [allAlt, noun] = EMBED_ALT[request.kind];
  const alt = provider === "all" ? allAlt : `My recorded ${providerName(provider)} ${noun}`;
  return { image: imageUrl, alt, markdown: `![${alt}](${imageUrl})` };
}

export function calendarEmbed(origin: string, provider: CardProvider, theme: CardTheme, look: CardLook = {}) {
  return widgetEmbed(origin, provider, theme, { kind: "calendar", ...look });
}

export function profileEmbed(origin: string, provider: CardProvider, theme: CardTheme, metrics: CardMetric[], look: CardLook = {}) {
  return widgetEmbed(origin, provider, theme, { kind: "usage", metrics, ...look });
}

export const UPSTREAM_REPOSITORY = "https://github.com/darrellchee/vibe-check";

// One click: clone the repo, create the project, and provision one free database (Upstash Redis
// unless another is chosen). `allowConnectExistingProduct` lets someone who already used a free plan
// pick a database they have instead of creating one; the app keeps its data under its own key prefix
// and Postgres schema, so it can share a database with other apps.
// No environment values are requested; secrets are generated when the owner claims the site.
// `redirect` is where Vercel sends the user afterwards; it appends `deployment-url` so the setup
// page can carry on at the new site.
export function deploymentUrl(
  repository = UPSTREAM_REPOSITORY,
  { redirect, storage }: { redirect?: string; storage?: StorageProviderId } = {},
) {
  const url = new URL(repository);
  if (url.origin !== "https://github.com" || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname) || url.search || url.hash || url.username || url.password)
    throw new Error("Enter a GitHub repository URL: https://github.com/owner/repo");
  const { integrationSlug, productSlug } = storageProvider(storage);
  const deploy = new URL("https://vercel.com/new/clone");
  deploy.searchParams.set("repository-url", url.href);
  // Only a suggestion: people rename the project and repository freely, so nothing relies on it.
  deploy.searchParams.set("project-name", "vibe-check");
  deploy.searchParams.set("repository-name", "vibe-check");
  deploy.searchParams.set("stores", JSON.stringify([
    { type: "integration", integrationSlug, productSlug, protocol: "storage", allowConnectExistingProduct: true },
  ]));
  if (redirect) deploy.searchParams.set("redirect-url", redirect);
  return deploy.href;
}
