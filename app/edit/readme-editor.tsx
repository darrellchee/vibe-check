"use client";
/* eslint-disable @next/next/no-img-element -- previews are data: SVGs and user-chosen remote images; optimization is unwanted */
import { Component, Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ErrorInfo, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, ChartColumn, Check, Columns2, Copy, Download, ExternalLink, GripVertical,
  Layers3, Plus, RefreshCw, RotateCcw, Rows2, Trash2, Type, Upload } from "lucide-react";
import ProviderNavigation from "@/components/provider-navigation";
import { hasHistory, loadHarnesses, type HarnessUsage } from "@/lib/overview";
import { PROVIDERS, providerName } from "@/lib/providers";
import { cardAccents, cardMetrics, cardSize, renderActivityCalendar, renderProfileCard, stylesFor,
  type CardAccent, type CardMetric, type CardStyle, type CardTheme } from "@/lib/profile-card";
import { sampleSnapshot } from "@/lib/sample-snapshot";
import { LOGIN_PATTERN, probeProfile, webPublish, type RepoProbe } from "@/lib/github-web";
import { parseMarkdown, type Inline, type MdBlock } from "@/lib/markdown";
import { insertBlock, joinTarget, leaveRow, makeBlock, MAX_BLOCKS, MAX_TEXT, MAX_WIDTH, MIN_WIDTH, placeBlock, PRESET_GROUPS, PRESETS,
  rowRanges, sameLayout, sanitizeBlocks, serializeReadme, snapWidth, stepBlock, widthOf,
  type DropTarget, type Preset, type PresetGroup, type ReadmeBlock } from "@/lib/readme-doc";
import type { UsageProvider, UsageSnapshot } from "@/lib/types";
import { Chrome, type ChromeTab } from "../github-profile/chrome";
import s from "../github-profile/profile.module.css";
import e from "./editor.module.css";

const STORAGE_KEY = "atlas:readme-editor:v1";
const TABS: ChromeTab[] = [
  { icon: "book", label: "Overview", selected: true },
  { icon: "repo", label: "Repositories" },
  { icon: "table", label: "Projects" },
  { icon: "package", label: "Packages" },
  { icon: "star", label: "Stars" },
];
const METRIC_LABELS: Record<CardMetric, string> = { tokens: "Tokens", sessions: "Sessions", requests: "Human requests" };
const STYLE_LABELS: Record<CardStyle, string> = { classic: "Classic", compact: "Compact", spotlight: "Spotlight" };
const ACCENT_LABELS: Record<CardAccent, string> = { lime: "Lime", orange: "Orange", blue: "Blue", violet: "Violet", mono: "Mono" };
const GROUP_ICONS = { "Usage cards": ChartColumn, "Activity calendars": CalendarDays, Markdown: Type } as const;

// Singular nouns for the add buttons; the group names are plural headings.
const GROUP_NOUN: Record<PresetGroup, string> = { "Usage cards": " usage card", "Activity calendars": " activity calendar", Markdown: "" };
const validLogin = (value: unknown) => (typeof value === "string" && LOGIN_PATTERN.test(value) ? value : "");

type WidgetBlock = Exclude<ReadmeBlock, { type: "text" }>;
type DragSource = { kind: "preset" | "block"; id: string };
type Status = "loading" | "locked" | "error" | "empty" | "ready";
type ProbeIssue = "disabled" | "pending";
// "on": this computer's GitHub CLI can publish for the owner with one click. "off": the editor links to
// GitHub's own page instead (a deployed copy, or no signed-in CLI).
type Cli = { status: "checking" } | { status: "off"; reason: string } | { status: "on"; login: string; repository: boolean; readme: boolean };
type Published = { login: string; status: "created" | "added" | "updated" | "unchanged" };
const PUBLISHED_TEXT: Record<Published["status"], string> = {
  created: "Created your profile repository and published your README.",
  added: "Published your README.",
  updated: "Updated your README.",
  unchanged: "Your profile README is already up to date.",
};
type FocusRequest = { id: string; act: "up" | "down" | "remove" } | { board: true };

const blockLabel = (b: ReadmeBlock) =>
  b.type === "text" ? "Markdown" : `${providerName(b.provider)} ${b.type === "usage" ? "usage card" : "activity calendar"}`;
const dataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const cardKind = (b: WidgetBlock) => (b.type === "usage" ? "usage" : "calendar");

function loadDraft() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return {
      blocks: sanitizeBlocks(draft?.blocks),
      origin: typeof draft?.origin === "string" ? draft.origin.slice(0, 200) : "",
      login: validLogin(draft?.login),
    };
  } catch { return null; }
}

// A malformed block or snapshot must never take the whole editor down: the preview falls back to
// a message and the draft is left untouched.
class PreviewBoundary extends Component<{ onBack: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("README preview failed", error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={e.previewFailed}>
        <p>This preview could not be rendered. Your README is unchanged.</p>
        <button type="button" className={e.btn} onClick={this.props.onBack}>Back to Edit</button>
      </div>
    );
  }
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

const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <>{blocks.map((block, i) => <MdNode key={i} block={block} />)}</>;
});

// Renders exactly what the public endpoint will serve, from the owner's live data, so the preview
// works before cards are published and while running locally.
const WidgetPreview = memo(function WidgetPreview({ block, snapshot, status, error }: {
  block: WidgetBlock; snapshot: UsageSnapshot | null; status: Status; error: string;
}) {
  // Resizing changes `block.width` on every pointer move; the SVG only depends on these fields.
  const { type, provider, theme, style, accent } = block;
  const metrics = block.type === "usage" ? block.metrics : null;
  const src = useMemo(() => {
    if (!snapshot) return "";
    try {
      return dataUri(type === "usage" && metrics
        ? renderProfileCard(snapshot, provider, theme, metrics, { style, accent })
        : renderActivityCalendar(snapshot, provider, theme, { style, accent }));
    } catch { return null; }
  }, [type, provider, theme, metrics, style, accent, snapshot]);
  if (src) {
    const { width, height } = cardSize(type, style);
    return <img className={e.widget} src={src} alt={`${blockLabel(block)} preview`} width={width} height={height} />;
  }
  // Announcements come from the editor's single live region, so these placeholders are plain text.
  return <div className={e.placeholder}>
    {src === null ? `The ${blockLabel(block)} could not be rendered from your latest data.`
      : status === "loading" ? "Loading your usage…"
        : status === "locked" ? <>Sign in to preview your data. <Link href="/all">Unlock the dashboard</Link></>
          : status === "error" ? error
            : <>No {providerName(block.provider)} usage recorded yet. <Link href="/setup">Connect its collector</Link></>}
  </div>;
});

// How a preset will look: its card drawn with the same renderer the README uses, or the Markdown it adds.
const PresetThumb = memo(function PresetThumb({ preset, snapshot }: { preset: Preset; snapshot: UsageSnapshot | null }) {
  const { block } = preset;
  const src = useMemo(() => {
    if (block.type === "text" || !snapshot) return "";
    const look = { style: block.style, accent: block.accent };
    try {
      return dataUri(block.type === "usage"
        ? renderProfileCard(snapshot, block.provider, block.theme, block.metrics, look)
        : renderActivityCalendar(snapshot, block.provider, block.theme, look));
    } catch { return ""; }
  }, [block, snapshot]);
  if (block.type === "text") return <div className={e.thumbText}><Markdown text={block.text || "Your own Markdown…"} /></div>;
  const { width, height } = cardSize(block.type, block.style);
  return src
    ? <img className={e.thumbImg} src={src} alt="" width={width} height={height} draggable={false} />
    : <div className={e.thumbEmpty} style={{ aspectRatio: `${width} / ${height}` }} />;
});

export default function ReadmeEditor({ fontClass }: { fontClass: string }) {
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
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [ready, setReady] = useState(false);
  const [harnesses, setHarnesses] = useState<HarnessUsage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [target, setTargetState] = useState<DropTarget | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<UsageProvider | "all">("all");
  // Sample data for thumbnails is created after mount, so server and client render the same markup.
  const [sampleNow, setSampleNow] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [probe, setProbe] = useState<Record<string, ProbeIssue>>({});
  const [cli, setCli] = useState<Cli>({ status: "checking" });
  const [web, setWeb] = useState<{ login: string; probe: RepoProbe } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<Published | null>(null);
  const [publishError, setPublishError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const focusRef = useRef<FocusRequest | null>(null);

  const username = validLogin(login);
  const full = blocks.length >= MAX_BLOCKS;
  const limitNote = `The README is limited to ${MAX_BLOCKS} blocks. Remove one to add more.`;
  // Repeating the same text would not re-announce, so alternate a trailing non-breaking space.
  const announce = useCallback((text: string) => setAnnouncement((prev) => (prev === text ? `${text}\u00a0` : text)), []);

  // Restore the draft after mount so the server and first client render agree (an empty README).
  useEffect(() => {
    const timer = setTimeout(() => {
      const draft = loadDraft();
      if (draft) { setBlocks(draft.blocks); setOrigin(draft.origin); setLogin(draft.login); }
      // A deployed copy is already at the public address its cards will be served from.
      if (!draft?.origin && window.location.protocol === "https:") setOrigin(window.location.origin);
      setSampleNow(Date.now());
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

  // Ask the server whether this computer's GitHub CLI can publish. If so, its account is the one
  // that gets the README, so it also fills in the username.
  useEffect(() => {
    if (!ready) return;
    let ignore = false;
    fetch("/api/publish", { cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() : { available: false, reason: "unreachable" }))
      .catch(() => ({ available: false, reason: "unreachable" }))
      .then((result) => {
        if (ignore) return;
        if (result?.available && validLogin(result.login)) {
          setCli({ status: "on", login: result.login, repository: Boolean(result.repository), readme: Boolean(result.readme) });
          setLogin(result.login);
        } else setCli({ status: "off", reason: String(result?.reason ?? "unreachable") });
      });
    return () => { ignore = true; };
  }, [ready]);

  // Without the CLI, look at the profile repository on GitHub so the button can go straight to the right
  // page. Looked up again when the tab regains focus, e.g. after creating the repository.
  const cliOff = cli.status === "off";
  useEffect(() => {
    if (!cliOff || !username) return;
    const controller = new AbortController();
    const look = () => void probeProfile(username, controller.signal).then((found) => {
      if (!controller.signal.aborted) setWeb({ login: username, probe: found });
    });
    const timer = setTimeout(look, 400);
    window.addEventListener("focus", look);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("focus", look); };
  }, [cliOff, username]);

  const snapshotOf = (provider: UsageProvider) => harnesses.find((h) => h.provider === provider)?.snapshot ?? null;
  const errorOf = (provider: UsageProvider) => {
    const message = harnesses.find((h) => h.provider === provider)?.error;
    return failed || !message ? `Could not load ${providerName(provider)} usage. Try refresh.` : `${providerName(provider)}: ${message}`;
  };
  const statusOf = (provider: UsageProvider): Status =>
    !loaded ? "loading" : locked ? "locked" : snapshotOf(provider) ? "ready"
      : failed || harnesses.find((h) => h.provider === provider)?.error ? "error" : "empty";
  const ranges = useMemo(() => rowRanges(blocks), [blocks]);
  // Thumbnails use your recorded usage; where a provider has none yet they use clearly labelled sample data.
  const samples = useMemo(() => sampleNow === null ? null
    : Object.fromEntries(PROVIDERS.map((p) => [p, sampleSnapshot(p, sampleNow)])) as Record<UsageProvider, UsageSnapshot>, [sampleNow]);
  const thumbSource = (provider: UsageProvider) => {
    const real = snapshotOf(provider);
    return real && hasHistory(real) ? { snapshot: real, sample: false } : { snapshot: samples?.[provider] ?? null, sample: true };
  };
  // The frame has the card's width, so the preview, the Edit view and the published README agree.
  const preview = (b: WidgetBlock, resizable = false) => (
    <div className={`${e.sizer} ${resizing === b.id ? e.resizing : ""}`} style={{ width: widthOf(b) }}>
      <WidgetPreview block={b} snapshot={snapshotOf(b.provider)} status={statusOf(b.provider)} error={errorOf(b.provider)} />
      {resizable && <>
        <span className={e.sizeTag} aria-hidden="true">{widthOf(b)} px</span>
        <span className={e.resize} aria-hidden="true" title="Drag to resize" onPointerDown={startResize(b)} />
      </>}
    </div>
  );

  const output = useMemo(() => serializeReadme(blocks, origin), [blocks, origin]);
  const hasWidgets = blocks.some((b) => b.type !== "text");
  const publishable = Boolean(output.markdown) && !output.originError;
  const originInvalid = Boolean(origin && output.originError);
  const patch = (id: string, change: Partial<WidgetBlock>) =>
    setBlocks((all) => all.map((b) => (b.id === id ? ({ ...b, ...change } as ReadmeBlock) : b)));
  const edited = () => { setCopied(false); setMessage(""); setPublished(null); setPublishError(""); };

  // The public card endpoint is what GitHub will load, but previews come from private data and look
  // fine even when it would 404. Probe each (provider, kind) the README uses, without reading the SVG.
  const pairKey = useMemo(() => [...new Set(blocks.flatMap((b) => (b.type === "text" ? [] : [`${b.provider}|${cardKind(b)}`])))].sort().join(","), [blocks]);
  useEffect(() => {
    if (!loaded || !pairKey) return;
    let ignore = false;
    void Promise.all(pairKey.split(",").map(async (pair): Promise<[string, ProbeIssue | null]> => {
      const [provider, kind] = pair.split("|");
      try {
        const response = await fetch(`/api/card?provider=${provider}&kind=${kind}&theme=dark`, { cache: "no-store" });
        void response.body?.cancel().catch(() => undefined);
        return [pair, response.status === 404 ? "disabled" : response.status === 503 ? "pending" : null];
      } catch { return [pair, null]; }
    })).then((results) => {
      if (ignore) return;
      setProbe(Object.fromEntries(results.filter((r): r is [string, ProbeIssue] => r[1] !== null)));
    });
    return () => { ignore = true; };
  }, [loaded, pairKey, harnesses]);
  const cardWarnings = useMemo(() => {
    const issues = new Map<UsageProvider, ProbeIssue>();
    for (const pair of pairKey ? pairKey.split(",") : []) {
      const issue = probe[pair];
      const provider = pair.split("|")[0] as UsageProvider;
      if (issue && issues.get(provider) !== "disabled") issues.set(provider, issue);
    }
    return [...issues];
  }, [pairKey, probe]);

  // Focus is restored after the list re-renders, because moving a focused node can drop focus.
  useEffect(() => {
    const request = focusRef.current;
    if (!request) return;
    focusRef.current = null;
    let target: HTMLElement | null | undefined;
    if ("board" in request) target = boardRef.current?.querySelector<HTMLElement>("[data-board-first]:not(:disabled)");
    else {
      const block = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []).find((el) => el.dataset.blockId === request.id);
      target = block?.querySelector<HTMLButtonElement>(`[data-act="${request.act}"]`);
      if (target instanceof HTMLButtonElement && target.disabled)
        target = block?.querySelector<HTMLButtonElement>(`[data-act="${request.act === "up" ? "down" : "up"}"]`);
    }
    target?.focus();
  }, [blocks]);

  const added = (block: ReadmeBlock, slot: number, total: number) =>
    announce(`Added ${blockLabel(block)}, position ${slot + 1} of ${total}`);
  function add(preset: Preset) {
    const current = blocksRef.current;
    if (current.length >= MAX_BLOCKS) { announce(limitNote); return; }
    const block = makeBlock(preset.block);
    setBlocks(insertBlock(current, current.length, block));
    added(block, current.length, current.length + 1);
    edited();
  }
  function remove(b: ReadmeBlock) {
    const current = blocksRef.current, at = current.findIndex((x) => x.id === b.id);
    if (at < 0) return;
    const neighbour = current[at + 1] ?? current[at - 1];
    focusRef.current = neighbour ? { id: neighbour.id, act: "remove" } : { board: true };
    setBlocks(current.filter((x) => x.id !== b.id));
    announce(`Removed ${blockLabel(b)} from position ${at + 1}. ${current.length - 1} ${current.length === 2 ? "block remains" : "blocks remain"}`);
    edited();
  }
  function move(b: ReadmeBlock, delta: -1 | 1) {
    const current = blocksRef.current, at = current.findIndex((x) => x.id === b.id);
    const next = stepBlock(current, b.id, delta);
    if (at < 0 || next === current) return;
    focusRef.current = { id: b.id, act: delta < 0 ? "up" : "down" };
    setBlocks(next);
    announce(`Moved ${blockLabel(b)} to position ${at + delta + 1} of ${current.length}`);
    edited();
  }
  function joinPrevious(b: ReadmeBlock) {
    const current = blocksRef.current, anchor = joinTarget(current, b.id);
    if (!anchor) return;
    const next = placeBlock(current, b, { beside: anchor, side: "right" });
    setBlocks(next);
    announce(placed(next, b, "Moved"));
    edited();
  }
  function ownRow(b: ReadmeBlock) {
    const next = leaveRow(blocksRef.current, b.id);
    if (next === blocksRef.current) return;
    setBlocks(next);
    announce(placed(next, b, "Moved"));
    edited();
  }
  // Resizing uses pointer events (not HTML5 drag): the width follows the pointer in 10px steps. The
  // width slider in the card's controls is the keyboard and touch alternative.
  function startResize(b: WidgetBlock) {
    return (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget, startX = event.clientX, startWidth = widthOf(b);
      handle.setPointerCapture(event.pointerId);
      setResizing(b.id);
      const move = (ev: PointerEvent) => patch(b.id, { width: snapWidth(startWidth + ev.clientX - startX) });
      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        setResizing(null);
        edited();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    };
  }

  function startDrag(source: DragSource) {
    return (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = source.kind === "preset" ? "copy" : "move";
      // A custom type keeps the browser from pasting the id into a focused textarea on drop.
      event.dataTransfer.setData("application/x-atlas-readme", source.id);
      const card = event.currentTarget.closest("[data-block-id]");
      if (source.kind === "block" && card) event.dataTransfer.setDragImage(card, 12, 12);
      setDrag(source);
    };
  }
  // The ref mirrors the target synchronously so a fast release never drops into a stale position.
  const setTarget = (next: DropTarget | null) => {
    if (JSON.stringify(next) === JSON.stringify(dropRef.current)) return;
    dropRef.current = next;
    setTargetState(next);
  };
  const endDrag = () => { setDrag(null); setTarget(null); };
  const dragType = drag?.kind === "preset" ? PRESETS.find((p) => p.id === drag.id)?.block.type : blocks.find((b) => b.id === drag?.id)?.type;
  const dragIsCard = dragType !== undefined && dragType !== "text";
  const dropEffect = (event: DragEvent<HTMLElement>) => { event.dataTransfer.dropEffect = drag?.kind === "preset" ? "copy" : "move"; };
  // Over a card, its outer quarters mean "beside it" (cards only); otherwise the top half targets the
  // gap above its row and the bottom half the gap below it.
  const overBlock = (b: ReadmeBlock, index: number) => (event: DragEvent<HTMLElement>) => {
    if (!drag) return;
    event.preventDefault();
    dropEffect(event);
    const box = event.currentTarget.getBoundingClientRect();
    const range = ranges.find((r) => index >= r.start && index < r.end);
    if (!range) return;
    const across = (event.clientX - box.left) / box.width;
    if (dragIsCard && b.type !== "text" && !(drag.kind === "block" && drag.id === b.id) && (across < 0.25 || across > 0.75))
      return setTarget({ beside: b.id, side: across < 0.25 ? "left" : "right" });
    setTarget({ slot: event.clientY < box.top + box.height / 2 ? range.start : range.end });
  };
  // The padding between blocks belongs to the row; only react there when the pointer isn't over a block.
  const overRow = (range: { start: number; end: number }) => (event: DragEvent<HTMLElement>) => {
    if (!drag || event.target !== event.currentTarget) return;
    event.preventDefault();
    dropEffect(event);
    const box = event.currentTarget.getBoundingClientRect();
    setTarget({ slot: event.clientY < box.top + box.height / 2 ? range.start : range.end });
  };
  const overEnd = (event: DragEvent<HTMLElement>) => {
    if (!drag) return;
    event.preventDefault();
    dropEffect(event);
    setTarget({ slot: blocksRef.current.length });
  };
  // relatedTarget is null in Safari, so judge by pointer position against the whole editing surface.
  const leave = (event: DragEvent<HTMLElement>) => {
    const box = bodyRef.current?.getBoundingClientRect();
    if (!box) return;
    const { clientX: x, clientY: y } = event;
    if (x <= box.left || x >= box.right || y <= box.top || y >= box.bottom) setTarget(null);
  };
  const placed = (next: ReadmeBlock[], moving: ReadmeBlock, verb: "Added" | "Moved") => {
    const at = next.findIndex((b) => b.id === moving.id);
    const range = rowRanges(next).find((r) => at >= r.start && at < r.end);
    if (range && range.end - range.start > 1) {
      const mate = next[at === range.start ? at + 1 : at - 1];
      return `${verb} ${blockLabel(moving)} beside ${blockLabel(mate)}, a row of ${range.end - range.start}`;
    }
    return `${verb} ${blockLabel(moving)}, position ${at + 1} of ${next.length}`;
  };
  function drop(event: DragEvent<HTMLElement>) {
    if (!drag) return;
    event.preventDefault();
    const current = blocksRef.current;
    let at = dropRef.current;
    if (!at) {
      const el = (event.target as HTMLElement).closest<HTMLElement>("[data-block-id]");
      const index = el ? current.findIndex((b) => b.id === el.dataset.blockId) : -1;
      const range = ranges.find((r) => index >= r.start && index < r.end);
      at = { slot: !el || !range ? current.length : event.clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 ? range.start : range.end };
    }
    let moving: ReadmeBlock | undefined;
    if (drag.kind === "preset") {
      const preset = PRESETS.find((p) => p.id === drag.id);
      if (preset && current.length >= MAX_BLOCKS) announce(limitNote);
      else if (preset) moving = makeBlock(preset.block);
    } else moving = current.find((b) => b.id === drag.id);
    if (moving) {
      const next = placeBlock(current, moving, at);
      if (!sameLayout(next, current)) {
        setBlocks(next);
        announce(placed(next, moving, drag.kind === "preset" ? "Added" : "Moved"));
      }
    }
    edited();
    endDrag();
  }
  // Dropping a block where it already is changes nothing, so don't promise a move with an indicator.
  const dragged = drag?.kind === "block" ? blocks.find((b) => b.id === drag.id) : undefined;
  const showTarget = target && !(dragged && sameLayout(placeBlock(blocks, dragged, target), blocks)) ? target : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(output.markdown);
      const text = "README copied. Paste it into your profile repository.";
      setCopied(true); setMessage(text); announce(text);
    } catch {
      const text = "Clipboard unavailable. Select and copy the Markdown above.";
      setMessage(text); announce(text);
    }
  }
  async function publish() {
    setPublishing(true); setPublishError(""); setPublished(null);
    try {
      const response = await fetch("/api/publish", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: output.markdown }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Could not publish to GitHub.");
      setPublished(result);
      setCli((prev) => (prev.status === "on" ? { ...prev, repository: true, readme: true } : prev));
      announce(PUBLISHED_TEXT[result.status as Published["status"]] ?? "Published to GitHub.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not publish to GitHub.";
      setPublishError(text); announce(text);
    } finally { setPublishing(false); }
  }
  // Without the CLI the button is a plain link, so the copy for long READMEs happens in the click itself.
  const webPlan = cli.status === "off" && username && web?.login === username ? webPublish(username, web.probe, output.markdown) : null;
  function openWeb() {
    if (!webPlan?.copy) return;
    void navigator.clipboard.writeText(output.markdown).then(() => announce("README copied."), () => announce("Clipboard unavailable. Copy the Markdown below."));
  }
  function download() {
    const url = URL.createObjectURL(new Blob([output.markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "README.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const cliPlan = cli.status === "on" ? {
    label: publishing ? "Publishing…" : !cli.repository ? "Create repository & publish" : cli.readme ? "Update my profile README" : "Publish to my profile",
    note: !cli.repository ? `Creates the public repository ${cli.login}/${cli.login} and adds your README to it.`
      : cli.readme ? `Replaces the README in ${cli.login}/${cli.login}. The previous version stays in the repository’s history.`
        : `Adds README.md to ${cli.login}/${cli.login}.`,
  } : null;
  const cliHint = cli.status !== "off" ? "" : cli.reason === "signed-out"
    ? "Run gh auth login in a terminal to publish with a single click from this computer."
    : cli.reason === "missing" ? "Install the GitHub CLI (cli.github.com) and run gh auth login to publish with a single click from this computer." : "";

  const total = blocks.length;
  return (
    <div className={e.page}>
      <div className={e.appbar}>
        <Link className={e.brand} href="/all" aria-label="Back to the dashboard"><Layers3 size={16} /> atlas</Link>
        <ProviderNavigation selected="edit" />
      </div>
      <div className={`${s.root} ${s.interactive} ${fontClass}`}>
        {/* The GitHub header and tabs are a look-only frame around the editor. */}
        <div aria-hidden="true">
          <Chrome viewer={{ login: username || "username", avatar: username ? `https://github.com/${username}.png?size=64` : undefined }} tabs={TABS} />
        </div>
        <main>
          <div className={s.container}>
            <div className={s.layout}>
              <div className={s.content}>
                <section className={e.card} aria-label="README editor">
                  <div className={e.cardHead}>
                    <div className={e.title}>
                      <span>{username || "username"}</span><span className={s.slash}>/</span><span>README</span><span className={s.muted}>.md</span>
                    </div>
                    <div className={e.segment} role="group" aria-label="README view">
                      {(["edit", "preview"] as const).map((m) => (
                        <button key={m} aria-pressed={mode === m} className={mode === m ? e.segmentOn : ""} onClick={() => setMode(m)}>
                          {m === "edit" ? "Edit" : "Preview"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {mode === "preview" ? (
                    <>
                      <article className={`${e.body} ${e.rendered}`}>
                        <PreviewBoundary onBack={() => setMode("edit")}>
                          {blocks.length === 0 ? <p className={e.muted}>Nothing to preview yet. Switch to Edit and add some elements.</p>
                            : ranges.map((range) => {
                              const row = blocks.slice(range.start, range.end), first = row[0];
                              return first.type === "text"
                                ? <Markdown key={first.id} text={first.text} />
                                : <div key={first.id} className={e.figureRow}>
                                  {row.map((b) => <Fragment key={b.id}>{preview(b as WidgetBlock)}</Fragment>)}
                                </div>;
                            })}
                        </PreviewBoundary>
                      </article>
                      <p className={e.previewNote}>Preview approximates GitHub: HTML, tables and nested lists are not rendered here.</p>
                    </>
                  ) : (
                    <div ref={bodyRef} className={e.body} onDragLeave={leave}>
                      {blocks.length === 0 && (
                        <div className={`${e.empty} ${drag ? e.emptyArmed : ""}`} onDragOver={overEnd} onDrop={drop}>
                          <strong>This README is empty.</strong>
                          <span>Drag an element from the board onto this page, or press + beside it.</span>
                        </div>
                      )}
                      {ranges.map((range) => (
                        <div key={blocks[range.start].id} className={e.blockRow} onDragOver={overRow(range)} onDrop={drop}>
                          {showTarget && "slot" in showTarget && showTarget.slot === range.start && <span className={e.insert} aria-hidden />}
                          {blocks.slice(range.start, range.end).map((b, k) => {
                            const i = range.start + k, inRow = range.end - range.start > 1;
                            const name = `${blockLabel(b)} (${i + 1} of ${total})`;
                            const earlier = inRow ? "left" : "up", later = inRow ? "right" : "down";
                            const joinable = joinTarget(blocks, b.id) !== null;
                            return (
                              <div key={b.id} data-block-id={b.id} onDragOver={overBlock(b, i)}
                                className={`${e.block} ${b.type === "text" ? e.wide : e.cardBlock} ${drag?.kind === "block" && drag.id === b.id ? e.dragging : ""}`}
                                style={b.type === "text" ? undefined : { width: widthOf(b) }}>
                                {showTarget && "beside" in showTarget && showTarget.beside === b.id &&
                                  <span className={`${e.insertSide} ${showTarget.side === "left" ? e.insertLeft : e.insertRight}`} aria-hidden />}
                                <div className={e.blockBar}>
                                  <span className={e.handle} draggable onDragStart={startDrag({ kind: "block", id: b.id })} onDragEnd={endDrag}
                                    title="Drag to reorder"><GripVertical size={16} aria-hidden /></span>
                                  <span className={e.blockLabel}>{blockLabel(b)}</span>
                                  <button className={e.iconBtn} data-act="up" aria-label={`Move ${name} ${earlier}`} disabled={stepBlock(blocks, b.id, -1) === blocks}
                                    onClick={() => move(b, -1)}>{inRow ? <ArrowLeft size={14} /> : <ArrowUp size={14} />}</button>
                                  <button className={e.iconBtn} data-act="down" aria-label={`Move ${name} ${later}`} disabled={stepBlock(blocks, b.id, 1) === blocks}
                                    onClick={() => move(b, 1)}>{inRow ? <ArrowRight size={14} /> : <ArrowDown size={14} />}</button>
                                  <button className={e.iconBtn} data-act="remove" aria-label={`Remove ${name}`}
                                    onClick={() => remove(b)}><Trash2 size={14} /></button>
                                </div>
                                {b.type === "text" ? (
                                  <textarea className={e.text} aria-label={`Markdown text, block ${i + 1} of ${total}`} spellCheck value={b.text}
                                    placeholder="Write Markdown…" maxLength={MAX_TEXT}
                                    rows={Math.max(3, b.text.split("\n").length + 1)}
                                    onChange={(ev) => { const text = ev.target.value; setBlocks((all) => all.map((x) => (x.id === b.id ? { ...x, text } : x))); edited(); }} />
                                ) : (
                                  <>
                                    {preview(b, true)}
                                    <div className={e.controls}>
                                      <label>Theme
                                        <select aria-label={`Theme for ${name}`} value={b.theme}
                                          onChange={(ev) => { patch(b.id, { theme: ev.target.value as CardTheme }); edited(); }}>
                                          <option value="dark">Dark</option><option value="light">Light</option>
                                        </select>
                                      </label>
                                      <label>Style
                                        <select aria-label={`Style for ${name}`} value={b.style ?? "classic"}
                                          onChange={(ev) => { patch(b.id, { style: ev.target.value as CardStyle }); edited(); }}>
                                          {stylesFor(b.type).map((st) => <option key={st} value={st}>{STYLE_LABELS[st]}</option>)}
                                        </select>
                                      </label>
                                      <label>Accent
                                        <select aria-label={`Accent colour for ${name}`} value={b.accent ?? "lime"}
                                          onChange={(ev) => { patch(b.id, { accent: ev.target.value as CardAccent }); edited(); }}>
                                          {cardAccents.map((ac) => <option key={ac} value={ac}>{ACCENT_LABELS[ac]}</option>)}
                                        </select>
                                      </label>
                                      {b.type === "usage" && (
                                        <div className={e.metrics} role="group" aria-label={`Metrics for ${name}`}>
                                          <span>Metrics</span>
                                          {cardMetrics.map((m) => (
                                            <label key={m}>
                                              <input type="checkbox" checked={b.metrics.includes(m)} disabled={b.metrics.length === 1 && b.metrics.includes(m)}
                                                onChange={() => { patch(b.id, { metrics: cardMetrics.filter((x) => (x === m ? !b.metrics.includes(m) : b.metrics.includes(x))) }); edited(); }} />
                                              {METRIC_LABELS[m]}
                                            </label>
                                          ))}
                                        </div>
                                      )}
                                      <label className={e.size}>Width
                                        <input type="range" min={MIN_WIDTH} max={MAX_WIDTH} step={10} value={widthOf(b)}
                                          aria-label={`Width of ${name}`} aria-valuetext={`${widthOf(b)} pixels`}
                                          onChange={(ev) => { patch(b.id, { width: snapWidth(Number(ev.target.value)) }); edited(); }} />
                                        <output>{widthOf(b)} px</output>
                                      </label>
                                      <button type="button" className={e.miniBtn} disabled={b.width === undefined}
                                        onClick={() => { patch(b.id, { width: undefined }); edited(); }}><RotateCcw size={12} aria-hidden />Reset size</button>
                                      {joinable && <button type="button" className={e.miniBtn} onClick={() => joinPrevious(b)}>
                                        <Columns2 size={12} aria-hidden />Beside previous</button>}
                                      {inRow && <button type="button" className={e.miniBtn} onClick={() => ownRow(b)}>
                                        <Rows2 size={12} aria-hidden />Own row</button>}
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      {blocks.length > 0 && (
                        <div className={`${e.tail} ${drag ? e.tailArmed : ""}`} onDragOver={overEnd} onDrop={drop}>
                          {showTarget && "slot" in showTarget && showTarget.slot === blocks.length && <span className={e.insert} aria-hidden />}
                          {drag ? "Drop here to add at the end" : ""}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className={`${e.card} ${e.publish}`} aria-label="Publish">
                  <div className={e.cardHead}><h2 className={e.cardTitle}>Publish to GitHub</h2></div>
                  <div className={e.body}>
                    <label htmlFor="readme-login">GitHub username</label>
                    <div className={e.row}>
                      <input id="readme-login" type="text" placeholder="octocat" value={login} maxLength={39} autoComplete="off"
                        autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(login && !username)} aria-describedby="readme-login-help"
                        readOnly={cli.status === "on"} onChange={(ev) => { setLogin(ev.target.value.trim()); edited(); }} />
                    </div>
                    <p id="readme-login-help" className={e.help}>
                      {login && !username
                        ? "Use letters, numbers and hyphens only, starting with a letter or number, up to 39 characters."
                        : cli.status === "on" ? "Taken from the GitHub account your GitHub CLI is signed in to."
                          : "Shown in the preview header and used for the avatar. It is only stored in this browser."}
                      {username && <>
                        {" "}<a href={`https://github.com/${username}/${username}`} target="_blank" rel="noreferrer noopener">Open your profile repository on GitHub</a>
                      </>}
                    </p>

                    <label htmlFor="readme-origin">Your deployed dashboard URL</label>
                    <div className={e.row}>
                      <input id="readme-origin" type="url" placeholder="https://your-instance.vercel.app" value={origin}
                        aria-invalid={originInvalid}
                        aria-describedby={originInvalid ? "readme-origin-error readme-origin-help" : "readme-origin-help"}
                        onChange={(ev) => { setOrigin(ev.target.value); edited(); }} />
                      <button className={e.btn} onClick={() => { setOrigin(window.location.origin); edited(); }}>Use this website’s URL</button>
                    </div>
                    {originInvalid && <p id="readme-origin-error" role="alert" className={`${e.help} ${e.error}`}>{output.originError}</p>}
                    <p id="readme-origin-help" className={e.help}>
                      {output.originError && !origin
                        ? "Cards are images GitHub loads from your dashboard, so enter its public HTTPS address."
                        : `Use a public HTTPS address.${hasWidgets ? " GitHub cannot load images from localhost." : ""}`}
                    </p>

                    {(output.warnings.length > 0 || cardWarnings.length > 0) && (
                      <ul className={e.warnings} aria-label="Publishing warnings">
                        {output.warnings.map((w, i) => <li key={`w${i}`}>{w}</li>)}
                        {cardWarnings.map(([provider, issue]) => issue === "disabled"
                          ? <li key={provider}>{providerName(provider)}’s public card is disabled, so its images will not load on GitHub. <Link href="/setup">Enable it in the setup page.</Link></li>
                          : <li key={provider}>No uploaded {providerName(provider)} snapshot yet, so its images will not load on GitHub until the collector syncs.</li>)}
                      </ul>
                    )}

                    <div className={e.actions}>
                      {cliPlan ? (
                        <button className={`${e.btn} ${e.primary} ${e.publishBtn}`} disabled={!publishable || publishing} onClick={() => void publish()}>
                          {publishing ? <RefreshCw size={15} className={e.spin} /> : <Upload size={15} />}{cliPlan.label}
                        </button>
                      ) : webPlan && publishable ? (
                        <a className={`${e.btn} ${e.primary} ${e.publishBtn}`} href={webPlan.href} target="_blank" rel="noreferrer noopener" onClick={openWeb}>
                          <ExternalLink size={15} />{webPlan.label}
                        </a>
                      ) : (
                        <button className={`${e.btn} ${e.primary} ${e.publishBtn}`} disabled>
                          <Upload size={15} />{cli.status === "checking" || (username && !web) ? "Checking GitHub…" : "Publish to GitHub"}
                        </button>
                      )}
                    </div>
                    <p className={e.help}>
                      {cliPlan ? cliPlan.note
                        : !username ? "Enter your GitHub username above and this becomes a one-click publish."
                          : webPlan && publishable ? webPlan.note : ""}
                      {!cliPlan && cliHint && <>{" "}{cliHint}</>}
                    </p>
                    {publishError && <p role="alert" className={`${e.help} ${e.error}`}>{publishError}</p>}
                    {published && (
                      <p role="status" className={`${e.help} ${e.success}`}>
                        {PUBLISHED_TEXT[published.status]}{" "}
                        <a href={`https://github.com/${published.login}`} target="_blank" rel="noreferrer noopener">View your profile on GitHub</a>
                      </p>
                    )}

                    <details className={e.manual}>
                      <summary>Prefer to publish it yourself?</summary>
                      <label htmlFor="readme-markdown">README.md</label>
                      <textarea id="readme-markdown" className={e.output} readOnly rows={Math.min(14, Math.max(5, output.markdown.split("\n").length + 1))}
                        value={output.markdown} placeholder="Add elements to the README above to generate its Markdown." />
                      <div className={e.actions}>
                        <button className={e.btn} disabled={!publishable} onClick={() => void copy()}>
                          {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy Markdown"}
                        </button>
                        <button className={e.btn} disabled={!publishable} onClick={download}><Download size={15} />Download README.md</button>
                      </div>
                      <p className={e.help}>{message}</p>
                      <p className={e.help}>
                        Create a public GitHub repository named exactly like your username, then paste this into its <code>README.md</code> (or
                        replace the file with the download). GitHub caches images, so cards can lag behind your latest sync. Calendars publish per-day
                        activity levels, and your dashboard stays password protected.
                      </p>
                    </details>
                  </div>
                </section>
              </div>

              <aside ref={boardRef} className={e.board} aria-label="Elements you can add to the README">
                <div className={e.boardHead}>
                  <h2>Elements</h2>
                  <button className={e.iconBtn} aria-label="Refresh usage data" disabled={busy} onClick={() => void refresh()}>
                    <RefreshCw size={14} className={busy ? e.spin : ""} />
                  </button>
                </div>
                <p className={e.boardHelp}>Drag a card onto the README, or press +. Each thumbnail shows how that card will look, drawn from your usage (or sample data where none is recorded yet).</p>
                {full && <p className={`${e.boardHelp} ${e.limit}`}>{limitNote}</p>}
                <div className={e.chips} role="group" aria-label="Show presets for">
                  {(["all", ...PROVIDERS] as const).map((f) => (
                    <button key={f} type="button" aria-pressed={boardFilter === f} className={boardFilter === f ? e.chipOn : ""}
                      onClick={() => setBoardFilter(f)}>{f === "all" ? "All" : providerName(f)}</button>
                  ))}
                </div>
                {PRESET_GROUPS.map((group: PresetGroup) => {
                  const GroupIcon = GROUP_ICONS[group];
                  const items = PRESETS.filter((p) => p.group === group && (boardFilter === "all" || !p.provider || p.provider === boardFilter));
                  return (
                    <section key={group} className={e.group}>
                      <h3><GroupIcon size={14} aria-hidden /> {group}</h3>
                      <ul>
                        {items.map((p) => {
                          const source = p.provider ? thumbSource(p.provider) : null;
                          return (
                            <li key={p.id} className={e.preset} draggable onDragStart={startDrag({ kind: "preset", id: p.id })} onDragEnd={endDrag}>
                              <div className={e.presetHead}>
                                <GripVertical size={14} aria-hidden className={e.grip} />
                                <span className={e.presetText}>
                                  <span>{p.title}{p.variant && <span className={e.variant}> · {p.variant}</span>}</span>
                                  <small>{p.hint}{source?.sample && source.snapshot ? " · sample data" : ""}</small>
                                </span>
                                <button className={e.iconBtn} aria-label={`Add ${p.title}${GROUP_NOUN[group]}${p.variant ? `, ${p.variant.toLowerCase()} style` : ""}`}
                                  disabled={full} title={full ? limitNote : undefined}
                                  {...(p.id === items[0].id ? { "data-board-first": "" } : {})}
                                  onClick={() => add(p)}><Plus size={14} /></button>
                              </div>
                              <div className={e.thumb} aria-hidden="true">
                                <PresetThumb preset={p} snapshot={source?.snapshot ?? null} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </aside>
            </div>
          </div>
        </main>
      </div>
      <p role="status" aria-live="polite" className={e.srOnly}>{announcement}</p>
    </div>
  );
}
