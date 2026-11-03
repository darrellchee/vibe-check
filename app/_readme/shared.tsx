"use client";
/* eslint-disable @next/next/no-img-element -- cards are data: SVGs and Markdown images are user-chosen remote images */
// What the README editor (/edit) and its preview (/preview) share: the draft saved in this browser,
// the owner's usage, and the renderers that draw cards and Markdown exactly as GitHub will.
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ErrorInfo, ReactNode } from "react";
import Link from "next/link";
import { combineSnapshots, loadHarnesses, type HarnessUsage } from "@/lib/overview";
import { providerName } from "@/lib/providers";
import { cardSize, renderCard, type CardKind, type CardTheme } from "@/lib/profile-card";
import { LOGIN_PATTERN } from "@/lib/github-web";
import { parseMarkdown, type Inline, type MdBlock } from "@/lib/markdown";
import { cardRequest, sanitizeBlocks, starterReadme, themeOf, type CardBlock, type ReadmeBlock } from "@/lib/readme-doc";
import type { CardProvider, UsageSnapshot } from "@/lib/types";
import r from "./readme.module.css";

const STORAGE_KEY = "vibe-check:readme-editor:v1";

export type WidgetBlock = CardBlock;
export type Status = "loading" | "locked" | "error" | "empty" | "ready";

export const validLogin = (value: unknown) => (typeof value === "string" && LOGIN_PATTERN.test(value) ? value : "");
export const KIND_NOUN: Record<CardKind, string> = {
  usage: "usage card", calendar: "contribution graph", trend: "usage trend", models: "model mix", ledger: "model ledger", harnesses: "usage by harness",
};
export const blockLabel = (b: ReadmeBlock) => (b.type === "text" ? "Markdown" : `${providerName(b.provider)} ${KIND_NOUN[b.type]}`);
export const dataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
export const cardKind = (b: WidgetBlock): CardKind => b.type;

// The colour scheme this browser asks for, kept current when the system switches. The server and the
// first client render assume light so their markup matches.
const DARK_QUERY = "(prefers-color-scheme: dark)";
const watchScheme = (onChange: () => void) => {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
export function useViewerScheme(): CardTheme {
  return useSyncExternalStore(watchScheme, () => (window.matchMedia(DARK_QUERY).matches ? "dark" : "light"), () => "light");
}

function loadDraft() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return {
      // The editor has no theme setting: every card follows the visitor's GitHub theme, even in drafts saved earlier.
      blocks: sanitizeBlocks(draft?.blocks).map((b) => (b.type === "text" ? b : { ...b, theme: "auto" as const })),
      origin: typeof draft?.origin === "string" ? draft.origin.slice(0, 200) : "",
      login: validLogin(draft?.login),
    };
  } catch { return null; }
}

// The README being built, kept in this browser. Both pages read and write the same draft, and a
// change made in another tab is followed here.
export function useDraft() {
  const [blocks, setBlocksState] = useState<ReadmeBlock[]>([]);
  // Handlers read and write through this ref, so two actions in one tick (double-click, key repeat)
  // compose instead of the second one overwriting the first with a stale list.
  const blocksRef = useRef<ReadmeBlock[]>([]);
  const setBlocks = useCallback((change: ReadmeBlock[] | ((all: ReadmeBlock[]) => ReadmeBlock[])) => {
    const next = typeof change === "function" ? change(blocksRef.current) : change;
    blocksRef.current = next;
    setBlocksState(next);
  }, []);
  const [origin, setOrigin] = useState("");
  const [login, setLogin] = useState("");
  const [ready, setReady] = useState(false);
  // A copy running on this computer (http) cannot serve images to GitHub.
  const [localCopy, setLocalCopy] = useState(false);

  // Restore after mount so the server and first client render agree (an empty README).
  useEffect(() => {
    const timer = setTimeout(() => {
      const draft = loadDraft();
      if (draft) { setBlocks(draft.blocks); setOrigin(draft.origin); setLogin(draft.login); }
      // First visit: start from a ready-made README.
      else setBlocks(starterReadme());
      // A deployed copy is already at the public address its cards will be served from.
      if (!draft?.origin && window.location.protocol === "https:") setOrigin(window.location.origin);
      setLocalCopy(window.location.protocol !== "https:");
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [setBlocks]);
  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks, origin, login: validLogin(login) })); } catch { /* storage blocked: keep working in memory */ }
  }, [ready, blocks, origin, login]);
  // Another tab edited the draft: follow it, keeping object identity when nothing changed.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const draft = loadDraft();
      if (!draft) return;
      setBlocks((prev) => (JSON.stringify(prev) === JSON.stringify(draft.blocks) ? prev : draft.blocks));
      setOrigin(draft.origin);
      setLogin((prev) => (validLogin(prev) === draft.login ? prev : draft.login));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setBlocks]);

  return { blocks, blocksRef, setBlocks, origin, setOrigin, login, setLogin, ready, localCopy };
}

// The owner's recorded usage, per harness. "All" adds up every harness that has recorded history,
// exactly as the public card endpoint does.
export function useUsage() {
  const [harnesses, setHarnesses] = useState<HarnessUsage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await loadHarnesses();
      setHarnesses(result.harnesses);
      setLocked(result.locked);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setLoaded(true); setBusy(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const combined = useMemo(() => combineSnapshots(harnesses.flatMap((h) => (h.snapshot ? [h.snapshot] : []))), [harnesses]);
  const snapshotOf = (provider: CardProvider) =>
    provider === "all" ? combined : harnesses.find((h) => h.provider === provider)?.snapshot ?? null;
  const errorOf = (provider: CardProvider) => {
    const message = (provider === "all" ? harnesses.find((h) => h.error) : harnesses.find((h) => h.provider === provider))?.error;
    const name = provider === "all" ? "your" : providerName(provider);
    return failed || !message ? `Could not load ${name} usage. Try refresh.` : provider === "all" ? message : `${providerName(provider)}: ${message}`;
  };
  const statusOf = (provider: CardProvider): Status =>
    !loaded ? "loading" : locked ? "locked" : snapshotOf(provider) ? "ready"
      : failed || (provider === "all" ? harnesses.some((h) => h.error) : harnesses.find((h) => h.provider === provider)?.error) ? "error" : "empty";
  return { harnesses, loaded, busy, refresh, snapshotOf, statusOf, errorOf };
}

// A malformed block or snapshot must never take a whole page down: the area falls back to a message
// and the draft is left untouched.
export class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("README preview failed", error, info.componentStack); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((n, i) => {
    switch (n.t) {
      case "text": return n.v;
      case "code": return <code key={i}>{n.v}</code>;
      case "strong": return <strong key={i}><Inlines nodes={n.c} /></strong>;
      case "em": return <em key={i}><Inlines nodes={n.c} /></em>;
      case "link": return <a key={i} href={n.href} target="_blank" rel="noreferrer noopener"><Inlines nodes={n.c} /></a>;
      case "image": return <img key={i} src={n.src} alt={n.alt} referrerPolicy="no-referrer" />;
    }
  })}</>;
}

function MdNode({ block }: { block: MdBlock }) {
  switch (block.t) {
    case "heading": { const Tag = `h${block.level}` as "h1"; return <Tag><Inlines nodes={block.c} /></Tag>; }
    case "paragraph": return <p><Inlines nodes={block.c} /></p>;
    case "quote": return <blockquote><Inlines nodes={block.c} /></blockquote>;
    case "code": return <pre><code>{block.text}</code></pre>;
    case "hr": return <hr />;
    case "list": {
      const items = block.items.map((item, i) => <li key={i}><Inlines nodes={item} /></li>);
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <>{blocks.map((block, i) => <MdNode key={i} block={block} />)}</>;
});

// Renders exactly what the public endpoint will serve, from the owner's live data, so the preview
// works before cards are published and while running locally. An "auto" card is drawn in `scheme`,
// the theme of whoever is looking.
export const WidgetPreview = memo(function WidgetPreview({ block, snapshot, status, error, scheme }: {
  block: WidgetBlock; snapshot: UsageSnapshot | null; status: Status; error: string; scheme: CardTheme;
}) {
  // Resizing changes `block.width` on every pointer move; the SVG only depends on the drawing options.
  const { type, provider, style } = block;
  const chosen = themeOf(block), theme = chosen === "auto" ? scheme : chosen;
  const request = JSON.stringify(cardRequest(block));
  const src = useMemo(() => {
    if (!snapshot) return "";
    try { return dataUri(renderCard(snapshot, provider, theme, JSON.parse(request))); }
    catch { return null; }
  }, [provider, theme, request, snapshot]);
  if (src) {
    const { width, height } = cardSize(type, style, snapshot, block.type === "harnesses" ? block.chart : undefined);
    return <img className={r.widget} src={src} alt={`${blockLabel(block)} preview`} width={width} height={height} draggable={false} />;
  }
  // Announcements come from each page's single live region, so these placeholders are plain text.
  return <div className={r.placeholder}>
    {src === null ? `The ${blockLabel(block)} could not be rendered from your latest data.`
      : status === "loading" ? "Loading your usage…"
        : status === "locked" ? <>Sign in to preview your data. <Link href="/setup">Sign in</Link></>
          : status === "error" ? error
            : block.provider === "all" ? <>No usage recorded yet from any harness. <Link href="/setup">Connect a collector</Link></>
              : <>No {providerName(block.provider)} usage recorded yet. <Link href="/setup">Connect its collector</Link></>}
  </div>;
});
