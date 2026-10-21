import type { UsageProvider, UsageSnapshot } from "./types";
import { providerName } from "./providers";

export type CardTheme = "dark" | "light";
export type CardMetric = "tokens" | "sessions" | "requests";
export const cardMetrics: CardMetric[] = ["tokens", "sessions", "requests"];
// "usage" is the summary card; "calendar" is a year of per-day activity levels.
export type CardKind = "usage" | "calendar";
export const cardKinds: CardKind[] = ["usage", "calendar"];
// Layouts: usage cards come in three, calendars in two. Accents recolour a card; lime is the original.
export type CardStyle = "classic" | "compact" | "spotlight";
export const cardStyles: CardStyle[] = ["classic", "compact", "spotlight"];
export const calendarStyles: CardStyle[] = ["classic", "compact"];
export type CardAccent = "lime" | "orange" | "blue" | "violet" | "mono";
export const cardAccents: CardAccent[] = ["lime", "orange", "blue", "violet", "mono"];
export interface CardLook { style?: CardStyle; accent?: CardAccent }
// Each provider's accent matches its colour on the dashboard.
export const providerAccent: Record<UsageProvider, CardAccent> = { codex: "lime", claude: "orange", cursor: "blue", antigravity: "violet" };
export const stylesFor = (kind: CardKind) => (kind === "calendar" ? calendarStyles : cardStyles);

// Natural size of each card's SVG, so previews can reserve space and resize proportionally.
export function cardSize(kind: CardKind, style: CardStyle = "classic") {
  if (kind === "calendar") return { width: 720, height: style === "compact" ? 160 : 210 };
  return { width: 560, height: style === "compact" ? 96 : style === "spotlight" ? 176 : 200 };
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

const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (c) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
);

export function cardOptions(url: URL) {
  const theme = url.searchParams.get("theme") ?? "dark";
  const metrics = (url.searchParams.get("metrics") ?? "tokens,sessions").split(",");
  if (url.searchParams.getAll("theme").length > 1 || !["dark", "light"].includes(theme))
    throw new Error("Choose theme=dark or theme=light.");
  if (url.searchParams.getAll("metrics").length > 1 || metrics.length > 3 ||
    new Set(metrics).size !== metrics.length || metrics.some((m) => !cardMetrics.includes(m as CardMetric)))
    throw new Error("Choose one to three unique metrics: tokens,sessions,requests.");
  const kind = url.searchParams.get("kind") ?? "usage";
  if (url.searchParams.getAll("kind").length > 1 || !cardKinds.includes(kind as CardKind))
    throw new Error("Choose kind=usage or kind=calendar.");
  const style = url.searchParams.get("style") ?? "classic";
  if (url.searchParams.getAll("style").length > 1 || !cardStyles.includes(style as CardStyle))
    throw new Error("Choose style=classic, style=compact or style=spotlight.");
  if (kind === "calendar" && !calendarStyles.includes(style as CardStyle))
    throw new Error("Calendars support style=classic or style=compact.");
  const accent = url.searchParams.get("accent") ?? "lime";
  if (url.searchParams.getAll("accent").length > 1 || !cardAccents.includes(accent as CardAccent))
    throw new Error("Choose accent=lime, orange, blue, violet or mono.");
  return { kind: kind as CardKind, theme: theme as CardTheme, metrics: metrics as CardMetric[], style: style as CardStyle, accent: accent as CardAccent };
}

export function renderProfileCard(snapshot: UsageSnapshot, provider: UsageProvider,
  theme: CardTheme, metrics: CardMetric[], look: CardLook = {}) {
  const colors = PALETTES[look.accent ?? "lime"][theme], style = look.style ?? "classic";
  const name = providerName(provider);
  const totals = { tokens: snapshot.totals.totalTokens, sessions: snapshot.totals.sessions, requests: snapshot.totals.humanRequests };
  const labels = { tokens: "RECORDED TOKENS", sessions: "SESSIONS", requests: "HUMAN REQUESTS" };
  const available = { tokens: snapshot.availability?.tokens !== false, sessions: snapshot.availability?.sessions !== false, requests: snapshot.availability?.humanRequests !== false };
  // No source model names, warnings, paths, usernames or arbitrary query strings enter the SVG.
  const updated = new Date(snapshot.generatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const stale = Date.now() - Date.parse(snapshot.generatedAt) > 90_000;
  const value = (metric: CardMetric) => available[metric] ? compact(totals[metric]) : "Unavailable";
  const summary = metrics.map((metric) => `${value(metric)} ${labels[metric].toLowerCase()}`).join(", ");
  const text = (x: number, y: number, fill: string, size: number, content: string, extra = "") =>
    `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}"${extra}>${content}</text>`;
  const stamp = `${stale ? "Last synced" : "Updated"} ${updated}`;
  const heading = `${escapeXml(provider.toUpperCase())} ATLAS`;
  const { width, height } = cardSize("usage", style);
  let body: string;
  if (style === "compact") {
    // One slim band: the title and sync time on top, every metric in a single row.
    const columns = metrics.map((metric, i) => {
      const x = 26 + i * (508 / metrics.length);
      return text(x, 68, colors.text, !available[metric] ? 17 : metrics.length === 3 ? 24 : 28, value(metric), ' font-weight="600"') +
        text(x, 85, colors.muted, 9, labels[metric], ' letter-spacing="1"');
    }).join("");
    body = text(26, 28, colors.accent, 11, heading, ' font-weight="600" letter-spacing="2"') +
      text(534, 28, colors.muted, 9, stamp, ' text-anchor="end"') + columns;
  } else if (style === "spotlight") {
    // The first metric is the hero; any others stack beside it.
    const [hero, ...rest] = metrics;
    const side = rest.map((metric, i) => {
      const y = 78 + i * 42;
      return text(350, y, colors.text, !available[metric] ? 15 : 26, value(metric), ' font-weight="600"') +
        text(350, y + 16, colors.muted, 9, labels[metric], ' letter-spacing="1"');
    }).join("");
    body = text(26, 35, colors.accent, 13, heading, ' font-weight="600" letter-spacing="2"') +
      `<circle cx="529" cy="30" r="4" fill="${colors.accent}"/>` +
      text(26, 100, colors.text, !available[hero] ? 28 : 54, value(hero), ' font-weight="700"') +
      text(26, 122, colors.muted, 10, labels[hero], ' letter-spacing="1"') + side +
      `<path d="M26 136H534" stroke="${colors.border}"/>` + text(26, 154, colors.muted, 10, stamp) +
      text(26, 168, colors.muted, 9, "Available history · not verified account lifetime");
  } else {
    const columns = metrics.map((metric, i) => {
      const x = 26 + i * (508 / metrics.length);
      return `<text x="${x}" y="98" fill="${colors.text}" font-size="${!available[metric] ? 21 : metrics.length === 3 ? 29 : 36}" font-weight="600">${value(metric)}</text><text x="${x}" y="122" fill="${colors.muted}" font-size="10" letter-spacing="1">${labels[metric]}</text>`;
    }).join("");
    body = `<text x="26" y="35" fill="${colors.accent}" font-size="13" font-weight="600" letter-spacing="2">${heading}</text><circle cx="529" cy="30" r="4" fill="${colors.accent}"/>${columns}<path d="M26 145H534" stroke="${colors.border}"/><text x="26" y="166" fill="${colors.muted}" font-size="10">${stamp}</text><text x="26" y="184" fill="${colors.muted}" font-size="9">Available history · not verified account lifetime</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(name)} usage</title><desc id="desc">${escapeXml(summary)}. Updated ${updated}. Available history, not verified account lifetime.</desc><rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="16" fill="${colors.bg}" stroke="${colors.border}"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif">${body}</g></svg>`;
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
export function renderActivityCalendar(snapshot: UsageSnapshot, provider: UsageProvider, theme: CardTheme, look: CardLook = {}) {
  const colors = PALETTES[look.accent ?? "lime"][theme], slim = look.style === "compact";
  // The compact style drops the footer: a header, the grid and the legend.
  const titleY = slim ? 26 : 35, gridY = slim ? 46 : 64, legendY = slim ? 140 : 173;
  const { width, height } = cardSize("calendar", slim ? "compact" : "classic");
  const name = providerName(provider);
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
    `<rect x="${26 + c.col * 12}" y="${gridY + c.row * 12}" width="10" height="10" rx="2" fill="${colors.levels[level(c.value)]}"/>`).join("");
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
    `<text x="${26 + l.col * 12}" y="${gridY - 8}" fill="${colors.muted}" font-size="9">${MONTHS[l.month]}</text>`).join("");
  const legend = colors.levels.map((fill, i) => `<rect x="${608 + i * 12}" y="${legendY}" width="10" height="10" rx="2" fill="${fill}"/>`).join("");
  const updated = new Date(snapshot.generatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const headline = measure ? `${compact(total)} ${measure} · ${days}` : "Unavailable";
  const footer = slim ? "" : `<path d="M26 160H694" stroke="${colors.border}"/><text x="26" y="181" fill="${colors.muted}" font-size="10">Updated ${updated}</text><text x="26" y="198" fill="${colors.muted}" font-size="9">Last 12 months · available history, not verified account lifetime</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(name)} activity</title><desc id="desc">${escapeXml(summary)}. Updated ${updated}. Available history, not verified account lifetime.</desc><rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="16" fill="${colors.bg}" stroke="${colors.border}"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif"><text x="26" y="${titleY}" fill="${colors.accent}" font-size="13" font-weight="600" letter-spacing="2">${escapeXml(provider.toUpperCase())} ATLAS</text><text x="694" y="${titleY}" fill="${colors.text}" font-size="13" font-weight="600" text-anchor="end">${escapeXml(headline)}</text>${months}${rects}${footer}<text x="604" y="${legendY + 8}" fill="${colors.muted}" font-size="9" text-anchor="end">Less</text>${legend}<text x="672" y="${legendY + 8}" fill="${colors.muted}" font-size="9">More</text></g></svg>`;
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
}

export function calendarEmbed(origin: string, provider: UsageProvider, theme: CardTheme, look: CardLook = {}) {
  const image = cardUrl(origin);
  image.searchParams.set("kind", "calendar");
  image.searchParams.set("provider", provider);
  image.searchParams.set("theme", theme);
  setLook(image, look);
  const imageUrl = markdownSafe(image);
  const alt = `My recorded ${providerName(provider)} activity`;
  return { image: imageUrl, alt, markdown: `![${alt}](${imageUrl})` };
}

export function profileEmbed(origin: string, provider: UsageProvider, theme: CardTheme, metrics: CardMetric[], look: CardLook = {}) {
  const image = cardUrl(origin);
  image.searchParams.set("provider", provider);
  image.searchParams.set("theme", theme);
  image.searchParams.set("metrics", metrics.join(","));
  setLook(image, look);
  const imageUrl = markdownSafe(image);
  const alt = `My recorded ${providerName(provider)} usage`;
  return { image: imageUrl, alt, markdown: `![${alt}](${imageUrl})` };
}

export const UPSTREAM_REPOSITORY = "https://github.com/darrellchee/vibe-check";

// One click: clone the repo, create the project, and provision a free Upstash Redis store.
// No environment values are requested; secrets are generated when the owner claims the site.
export function deploymentUrl(repository = UPSTREAM_REPOSITORY) {
  const url = new URL(repository);
  if (url.origin !== "https://github.com" || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname) || url.search || url.hash || url.username || url.password)
    throw new Error("Enter a GitHub repository URL: https://github.com/owner/repo");
  const deploy = new URL("https://vercel.com/new/clone");
  deploy.searchParams.set("repository-url", url.href);
  deploy.searchParams.set("project-name", "vibe-check");
  deploy.searchParams.set("repository-name", "vibe-check");
  deploy.searchParams.set("stores", JSON.stringify([
    { type: "integration", integrationSlug: "upstash", productSlug: "upstash-kv", protocol: "storage" },
  ]));
  return deploy.href;
}
