"use client";
/* eslint-disable @next/next/no-img-element -- thumbnails are data: SVGs drawn by the card renderer */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, ChartArea, ChartBarStacked, ChartColumn, ChartPie, Check, ChevronDown, Columns2, GripVertical, Plus,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw, RotateCcw, Rows2, Table2, Trash2, Type } from "lucide-react";
import { TopNav } from "@/components/vibe-check-chrome";
import { combineSnapshots, hasHistory } from "@/lib/overview";
import { PROVIDERS, providerName } from "@/lib/providers";
import { accentColor, cardAccents, cardAnimations, cardFonts, cardMetrics, cardSize, fontStack, harnessCharts, maxMetrics, renderCard, defaultCardTitle, DEFAULT_LABELS, TITLE_MAX, LABEL_MAX, stylesFor, trendDays, trendMeasures,
  usageSlots, type MetricLabels, type MetricSlot, type CardAccent, type CardAnimation, type CardFont, type CardMetric, type CardStyle, type CardTheme, type HarnessChart, type TrendDays, type TrendMeasure } from "@/lib/profile-card";
import { sampleSnapshot } from "@/lib/sample-snapshot";
import { cardRequest, insertBlock, moveMetric, toggleMetric, joinTarget, leaveRow, makeBlock, MAX_BLOCKS, MAX_TEXT, MIN_WIDTH, placeBlock, PRESET_GROUPS, PRESETS, ROW_BUDGET,
  maxWidthFor, resizeBlock, rowRanges, sameLayout, stepBlock, widthOf,
  type DropTarget, type Preset, type PresetGroup, type ReadmeBlock } from "@/lib/readme-doc";
import type { CardProvider, UsageProvider, UsageSnapshot } from "@/lib/types";
import { blockLabel, dataUri, PreviewBoundary, useDraft, useUsage, useViewerScheme, validLogin, WidgetPreview, type WidgetBlock } from "../_readme/shared";
import e from "./editor.module.css";

const METRIC_LABELS: Record<CardMetric, string> = { tokens: "Tokens", sessions: "Sessions", requests: "Requests", cost: "Est. cost" };
const STYLE_LABELS: Record<CardStyle, string> = {
  classic: "Classic", compact: "Compact", spotlight: "Spotlight", tiles: "Tiles", list: "List", bars: "Bars",
  months: "Months", spark: "Sparkline", donut: "Donut", stacked: "Stacked",
};
const DAY_LABELS: Record<TrendDays, string> = { 30: "30 days", 90: "90 days", 365: "12 months" };
const MEASURE_LABELS: Record<TrendMeasure, string> = { tokens: "Tokens", cost: "Est. cost" };
const CHART_LABELS: Record<HarnessChart, string> = { bar: "Bar graph", pie: "Pie chart" };
const FONT_LABELS: Record<CardFont, string> = {
  system: "Inter", helvetica: "Helvetica", geometric: "Geometric", humanist: "Humanist", verdana: "Verdana",
  rounded: "Rounded", serif: "Serif", palatino: "Palatino", garamond: "Garamond", mono: "Monospace",
  typewriter: "Typewriter", condensed: "Condensed", display: "Display", handwritten: "Handwritten",
};
const ANIMATION_LABELS: Record<CardAnimation, string> = { none: "None", fade: "Fade in", shimmer: "Shimmer", pulse: "Pulse" };
const ANIMATION_HINTS: Record<CardAnimation, string> = {
  none: "A still card", fade: "Pieces rise in once as the card loads",
  shimmer: "A soft light sweeps across every few seconds", pulse: "The outline and title gently glow",
};
// Swatches are drawn in the colour the card itself will use: bright for dark cards, deeper for light ones.
const ACCENTS: Record<CardAccent, { label: string }> = {
  lime: { label: "Lime" }, orange: { label: "Orange" }, blue: { label: "Blue" }, violet: { label: "Violet" }, mono: { label: "Mono" },
};
const GROUP_ICONS = {
  "Usage cards": ChartColumn, "Activity calendars": CalendarDays, "Usage trends": ChartArea, "Model mix": ChartBarStacked, "Model ledgers": Table2, "Usage by harness": ChartPie, Markdown: Type,
} as const;
// Singular nouns for the add buttons; the group names are plural headings.
const GROUP_NOUN: Record<PresetGroup, string> = {
  "Usage cards": " usage card", "Activity calendars": " contribution graph", "Usage trends": " usage trend", "Model mix": " model mix", "Model ledgers": " model ledger", "Usage by harness": " of usage by harness", Markdown: "",
};
// Elements offers one of each kind, in its plain Classic look; everything else is changed in the Inspector.
const GROUP_LABELS: Record<PresetGroup, string> = {
  "Usage cards": "Usage card", "Activity calendars": "Contribution graph", "Usage trends": "Usage trend", "Model mix": "Model mix", "Model ledgers": "Model ledger", "Usage by harness": "Usage by harness", Markdown: "Markdown",
};
// The harness card is offered in both variants, since its bar and pie charts look nothing alike.
const isOffered = (p: Preset) => (p.group === "Markdown" ? p.id === "text" : p.group === "Usage by harness" || p.variant === "Classic");

// A usage card's metrics in the order the card lays them out. Drag one past its neighbour (or focus it
// and use the arrow keys) to move it; the card redraws as it moves. The drag has its own data type and
// stops at this list, so the page's block drag never sees it.
function MetricOrder({ metrics, spotlight, onChange }: { metrics: CardMetric[]; spotlight: boolean; onChange: (next: CardMetric[]) => void }) {
  const [dragging, setDragging] = useState<CardMetric | null>(null);
  const [said, setSaid] = useState("");
  const buttons = useRef(new Map<CardMetric, HTMLButtonElement>());
  // After a keyboard move the list re-renders; focus follows the metric that moved.
  const refocus = useRef<CardMetric | null>(null);
  useEffect(() => {
    if (refocus.current) buttons.current.get(refocus.current)?.focus();
    refocus.current = null;
  }, [metrics]);
  const move = (metric: CardMetric, to: number) => {
    const next = moveMetric(metrics, metrics.indexOf(metric), to);
    if (next === metrics) return false;
    onChange(next);
    setSaid(`${METRIC_LABELS[metric]} moved to position ${next.indexOf(metric) + 1} of ${next.length}`);
    return true;
  };
  // Moving only once the pointer is past the target's middle keeps two neighbours from swapping back and forth.
  const over = (target: CardMetric) => (event: DragEvent<HTMLElement>) => {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const from = metrics.indexOf(dragging), to = metrics.indexOf(target);
    if (from === to) return;
    const box = event.currentTarget.getBoundingClientRect(), middle = box.top + box.height / 2;
    if (to > from ? event.clientY > middle : event.clientY < middle) move(dragging, to);
  };
  const stop = (event: DragEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); };
  return (
    <div className={e.order}>
      <span className={e.label} id="insp-order">Order on the card</span>
      <ol className={e.orderList} aria-labelledby="insp-order" aria-describedby="insp-order-help">
        {metrics.map((m, i) => (
          <li key={m}>
            <button type="button" draggable className={`${e.orderItem} ${dragging === m ? e.orderDragging : ""}`}
              ref={(el) => { if (el) buttons.current.set(m, el); else buttons.current.delete(m); }}
              aria-label={`${METRIC_LABELS[m]}, position ${i + 1} of ${metrics.length}`}
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-vibe-check-metric", m);
                setDragging(m);
              }}
              onDragOver={over(m)} onDrop={stop} onDragEnd={() => setDragging(null)}
              onKeyDown={(event) => {
                const step = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
                if (!step) return;
                event.preventDefault();
                if (move(m, i + step)) refocus.current = m;
              }}>
              <GripVertical size={14} aria-hidden className={e.orderGrip} />
              <span className={e.orderNum} aria-hidden>{i + 1}</span>
              <span>{METRIC_LABELS[m]}</span>
              {spotlight && i === 0 && <span className={e.orderTag} aria-hidden>Big number</span>}
            </button>
          </li>
        ))}
      </ol>
      <p id="insp-order-help" className={e.hint}>Drag to rearrange, or focus one and use the arrow keys.</p>
      <span className="sr-only" aria-live="polite">{said}</span>
    </div>
  );
}

// Drag targets laid over a usage card's figures, so the numbers can be rearranged on the card itself.
// The renderer reports where it drew each metric (`usageSlots`); the boxes are placed in percentages of
// the card, so they line up at any width. Dragging uses pointer events and swaps live: the card redraws
// as the number crosses its neighbours. Keyboard users have the Inspector's order list.
function MetricDrag({ snapshot, provider, metrics, style, labels, onChange }: {
  snapshot: UsageSnapshot; provider: CardProvider; metrics: CardMetric[]; style?: CardStyle; labels?: MetricLabels; onChange: (next: CardMetric[]) => void;
}) {
  const layout = useMemo(() => usageSlots(snapshot, provider, metrics, { style, labels }), [snapshot, provider, metrics, style, labels]);
  const [held, setHeld] = useState<CardMetric | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // After a swap the two boxes change places and sizes; the neighbour just passed stays locked until the
  // pointer leaves it, so a pointer resting on the seam can't swap them back and forth.
  const locked = useRef<CardMetric | null>(null);
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const start = (metric: CardMetric) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    locked.current = null;
    setHeld(metric);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    if (!held || !box.current) return;
    // Each slot is keyed by its metric, so the held one keeps its pointer capture across redraws, and these
    // handlers are rebuilt every render with the current layout.
    const rect = box.current.getBoundingClientRect(), now = layout, order = metrics;
    const x = ((event.clientX - rect.left) / rect.width) * now.width, y = ((event.clientY - rect.top) / rect.height) * now.height;
    const inside = (s: MetricSlot) => x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height;
    if (locked.current && !now.slots.some((s) => s.metric === locked.current && inside(s))) locked.current = null;
    const over = now.slots.find((s) => s.metric !== held && s.metric !== locked.current && inside(s));
    if (!over) return;
    locked.current = over.metric;
    onChange(moveMetric(order, order.indexOf(held), order.indexOf(over.metric)));
  };
  const end = () => { setHeld(null); locked.current = null; };
  return (
    <div ref={box} className={`${e.metricDrag} ${held ? e.metricDragging : ""}`} aria-hidden="true">
      {layout.slots.map((s) => (
        <span key={s.metric} className={`${e.metricSlot} ${held === s.metric ? e.metricHeld : ""}`} title="Drag to rearrange"
          style={{ left: pct(s.x, layout.width), top: pct(s.y, layout.height), width: pct(s.width, layout.width), height: pct(s.height, layout.height) }}
          onPointerDown={start(s.metric)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      ))}
    </div>
  );
}

type DragSource = { kind: "preset" | "block"; id: string };
// After a list change, focus goes to an Inspector button (move) or to a block on the page (remove).
type FocusRequest = { act: "up" | "down" } | { block: string } | { board: true };

// The side panels: width and open/closed, remembered in this browser. Collapsed panels leave a slim rail.
const PANELS_KEY = "vibe-check:editor-panels:v1";
type Side = "left" | "right";
const PANEL_LIMITS = { left: { def: 280, min: 220, max: 440 }, right: { def: 320, min: 260, max: 480 } } as const;
const RAIL_WIDTH = 56, PAGE_MIN = 380;
type Panels = { left: number; right: number; leftOpen: boolean; rightOpen: boolean };
const fitWidth = (side: Side, width: number, max: number = PANEL_LIMITS[side].max) =>
  Math.round(Math.max(PANEL_LIMITS[side].min, Math.min(max, width)));

function usePanels() {
  const [panels, setPanels] = useState<Panels>({ left: PANEL_LIMITS.left.def, right: PANEL_LIMITS.right.def, leftOpen: true, rightOpen: true });
  const [ready, setReady] = useState(false);
  // Restored after mount so the server and first client render agree.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(PANELS_KEY) ?? "null");
        if (saved && typeof saved === "object") setPanels((prev) => ({
          left: typeof saved.left === "number" ? fitWidth("left", saved.left) : prev.left,
          right: typeof saved.right === "number" ? fitWidth("right", saved.right) : prev.right,
          leftOpen: saved.leftOpen !== false,
          rightOpen: saved.rightOpen !== false,
        }));
      } catch { /* storage blocked or unreadable: use the defaults */ }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(PANELS_KEY, JSON.stringify(panels)); } catch { /* keep working in memory */ }
  }, [ready, panels]);
  // A panel never grows so far that the page between them gets squeezed below PAGE_MIN.
  const resize = useCallback((side: Side, width: number) => setPanels((prev) => {
    const other = side === "left" ? (prev.rightOpen ? prev.right : RAIL_WIDTH) : (prev.leftOpen ? prev.left : RAIL_WIDTH);
    const room = window.innerWidth - other - PAGE_MIN;
    return { ...prev, [side]: fitWidth(side, width, Math.max(PANEL_LIMITS[side].min, Math.min(PANEL_LIMITS[side].max, room))) };
  }), []);
  const toggle = useCallback((side: Side) => setPanels((prev) => ({ ...prev, [side === "left" ? "leftOpen" : "rightOpen"]: !prev[side === "left" ? "leftOpen" : "rightOpen"] })), []);
  return { panels, resize, toggle };
}

// The draggable edge between a panel and the page. Arrow keys resize it too (Shift for bigger steps),
// and a double-click puts it back to its default width.
function PanelHandle({ side, width, onResize, onActive }: { side: Side; width: number; onResize: (width: number) => void; onActive: (on: boolean) => void }) {
  const [active, setActive] = useState(false);
  const { min, max, def } = PANEL_LIMITS[side];
  const set = (on: boolean) => { setActive(on); onActive(on); };
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget, startX = event.clientX, startWidth = width;
    handle.setPointerCapture(event.pointerId);
    set(true);
    const move = (ev: PointerEvent) => onResize(startWidth + (side === "left" ? ev.clientX - startX : startX - ev.clientX));
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      set(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }
  function key(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 10, grow = side === "left" ? "ArrowRight" : "ArrowLeft", shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (event.key === grow) onResize(width + step);
    else if (event.key === shrink) onResize(width - step);
    else if (event.key === "Home") onResize(min);
    else if (event.key === "End") onResize(max);
    else return;
    event.preventDefault();
  }
  return (
    <div role="separator" aria-orientation="vertical" tabIndex={0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
      aria-label={`Resize ${side === "left" ? "Elements" : "Inspector"} panel`} title="Drag to resize. Double-click to reset."
      className={`${e.handleBar} ${side === "left" ? e.handleLeft : e.handleRight}`} {...(active ? { "data-active": "" } : {})}
      onPointerDown={start} onKeyDown={key} onDoubleClick={() => onResize(def)} />
  );
}

// How a preset will look: its card drawn with the same renderer the README uses.
const PresetThumb = memo(function PresetThumb({ preset, snapshot, scheme }: { preset: Preset; snapshot: UsageSnapshot | null; scheme: CardTheme }) {
  const { block } = preset;
  const src = useMemo(() => {
    if (block.type === "text" || !snapshot) return "";
    const theme = block.theme === "auto" ? scheme : block.theme;
    try { return dataUri(renderCard(snapshot, block.provider, theme, cardRequest({ ...block, id: "" }))); }
    catch { return ""; }
  }, [block, snapshot, scheme]);
  if (block.type === "text") return null;
  const { width, height } = cardSize(block.type, block.style, snapshot, block.type === "harnesses" ? block.chart : undefined);
  return src
    ? <img className={e.thumbImg} src={src} alt="" width={width} height={height} draggable={false} />
    : <div className={e.thumbEmpty} style={{ aspectRatio: `${width} / ${height}` }} />;
});

export default function ReadmeEditor() {
  const { blocks, blocksRef, setBlocks, login, ready } = useDraft();
  const usage = useUsage();
  const { snapshotOf, statusOf, errorOf } = usage;
  // The page is drawn like GitHub's README background: in your system's theme until you pick one.
  // Auto cards follow it, so what you see is what a visitor with that GitHub theme sees.
  const systemScheme = useViewerScheme();
  const [pagePick, setPagePick] = useState<CardTheme | null>(null);
  const scheme = pagePick ?? systemScheme;
  const [selected, setSelected] = useState<string | null>(null);
  const { panels, resize: resizePanel, toggle: togglePanel } = usePanels();
  const [panelDragging, setPanelDragging] = useState(false);
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [target, setTargetState] = useState<DropTarget | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<CardProvider>("all");
  // Sample data for thumbnails is created after mount, so server and client render the same markup.
  const [sampleNow, setSampleNow] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const focusRef = useRef<FocusRequest | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSampleNow(Date.now()), 0);
    return () => clearTimeout(timer);
  }, []);

  const username = validLogin(login);
  const total = blocks.length;
  const full = total >= MAX_BLOCKS;
  const limitNote = `The README is limited to ${MAX_BLOCKS} blocks. Remove one to add more.`;
  // Repeating the same text would not re-announce, so alternate a trailing non-breaking space.
  const announce = useCallback((text: string) => setAnnouncement((prev) => (prev === text ? `${text} ` : text)), []);
  const ranges = useMemo(() => rowRanges(blocks), [blocks]);
  const current = blocks.find((b) => b.id === selected) ?? null;

  // Thumbnails use your recorded usage; where a provider has none yet they use clearly labelled sample data.
  const samples = useMemo(() => {
    if (sampleNow === null) return null;
    const each = Object.fromEntries(PROVIDERS.map((p) => [p, sampleSnapshot(p, sampleNow)])) as Record<UsageProvider, UsageSnapshot>;
    return { ...each, all: combineSnapshots(Object.values(each)) } as Record<CardProvider, UsageSnapshot | null>;
  }, [sampleNow]);
  const thumbSource = (provider: CardProvider) => {
    const real = snapshotOf(provider);
    return real && hasHistory(real) ? { snapshot: real, sample: false } : { snapshot: samples?.[provider] ?? null, sample: true };
  };

  // Focus is restored after the list re-renders, because moving or removing a focused node can drop focus.
  useEffect(() => {
    const request = focusRef.current;
    if (!request) return;
    focusRef.current = null;
    let next: HTMLElement | null | undefined;
    if ("board" in request) next = boardRef.current?.querySelector<HTMLElement>("[data-board-first]:not(:disabled)");
    else if ("block" in request) {
      const el = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []).find((n) => n.dataset.blockId === request.block);
      next = el?.querySelector<HTMLElement>("[data-select]");
    } else {
      next = inspectorRef.current?.querySelector<HTMLButtonElement>(`[data-act="${request.act}"]`);
      if (next instanceof HTMLButtonElement && next.disabled)
        next = inspectorRef.current?.querySelector<HTMLButtonElement>(`[data-act="${request.act === "up" ? "down" : "up"}"]`);
    }
    next?.focus();
  }, [blocks]);

  const placed = (next: ReadmeBlock[], moving: ReadmeBlock, verb: "Added" | "Moved") => {
    const at = next.findIndex((b) => b.id === moving.id);
    const range = rowRanges(next).find((r) => at >= r.start && at < r.end);
    if (range && range.end - range.start > 1) {
      const mate = next[at === range.start ? at + 1 : at - 1];
      return `${verb} ${blockLabel(moving)} beside ${blockLabel(mate)}, a row of ${range.end - range.start}`;
    }
    return `${verb} ${blockLabel(moving)}, position ${at + 1} of ${next.length}`;
  };
  function add(preset: Preset) {
    const list = blocksRef.current;
    if (list.length >= MAX_BLOCKS) { announce(limitNote); return; }
    const block = makeBlock(preset.block);
    setBlocks(insertBlock(list, list.length, block));
    setSelected(block.id);
    announce(`Added ${blockLabel(block)}, position ${list.length + 1} of ${list.length + 1}`);
  }
  function remove(b: ReadmeBlock) {
    const list = blocksRef.current, at = list.findIndex((x) => x.id === b.id);
    if (at < 0) return;
    const neighbour = list[at + 1] ?? list[at - 1];
    focusRef.current = neighbour ? { block: neighbour.id } : { board: true };
    setBlocks(list.filter((x) => x.id !== b.id));
    setSelected(neighbour?.id ?? null);
    announce(`Removed ${blockLabel(b)} from position ${at + 1}. ${list.length - 1} ${list.length === 2 ? "block remains" : "blocks remain"}`);
  }
  function move(b: ReadmeBlock, delta: -1 | 1) {
    const list = blocksRef.current, at = list.findIndex((x) => x.id === b.id);
    const next = stepBlock(list, b.id, delta);
    if (at < 0 || next === list) return;
    focusRef.current = { act: delta < 0 ? "up" : "down" };
    setBlocks(next);
    announce(`Moved ${blockLabel(b)} to position ${at + delta + 1} of ${list.length}`);
  }
  function joinPrevious(b: ReadmeBlock) {
    const list = blocksRef.current, anchor = joinTarget(list, b.id);
    if (!anchor) return;
    const next = placeBlock(list, b, { beside: anchor, side: "right" });
    setBlocks(next);
    announce(placed(next, b, "Moved"));
  }
  function ownRow(b: ReadmeBlock) {
    const next = leaveRow(blocksRef.current, b.id);
    if (next === blocksRef.current) return;
    setBlocks(next);
    announce(placed(next, b, "Moved"));
  }
  const patch = (id: string, change: Partial<WidgetBlock>) =>
    setBlocks((all) => all.map((b) => (b.id === id ? ({ ...b, ...change } as ReadmeBlock) : b)));

  // Resizing uses pointer events (not HTML5 drag): the width follows the pointer in 10px steps. The page
  // is drawn smaller than GitHub's 800px column, so pointer distance is scaled up to README pixels. The
  // Inspector's width slider is the keyboard and touch alternative.
  function startResize(b: WidgetBlock) {
    return (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget, startX = event.clientX, startWidth = widthOf(b);
      const row = handle.closest<HTMLElement>("[data-row]");
      const scale = row ? ROW_BUDGET / Math.max(1, row.getBoundingClientRect().width) : 1;
      handle.setPointerCapture(event.pointerId);
      setResizing(b.id);
      setSelected(b.id);
      const onMove = (ev: PointerEvent) => setBlocks((all) => resizeBlock(all, b.id, startWidth + (ev.clientX - startX) * scale));
      const stop = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        setResizing(null);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    };
  }

  function startDrag(source: DragSource) {
    return (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = source.kind === "preset" ? "copy" : "move";
      // A custom type keeps the browser from pasting the id into a focused textarea on drop.
      event.dataTransfer.setData("application/x-vibe-check-readme", source.id);
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
  // relatedTarget is null in Safari, so judge by pointer position against the whole page sheet.
  const leave = (event: DragEvent<HTMLElement>) => {
    const box = bodyRef.current?.getBoundingClientRect();
    if (!box) return;
    const { clientX: x, clientY: y } = event;
    if (x <= box.left || x >= box.right || y <= box.top || y >= box.bottom) setTarget(null);
  };
  function drop(event: DragEvent<HTMLElement>) {
    if (!drag) return;
    event.preventDefault();
    const list = blocksRef.current;
    let at = dropRef.current;
    if (!at) {
      const el = (event.target as HTMLElement).closest<HTMLElement>("[data-block-id]");
      const index = el ? list.findIndex((b) => b.id === el.dataset.blockId) : -1;
      const range = ranges.find((r) => index >= r.start && index < r.end);
      at = { slot: !el || !range ? list.length : event.clientY < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 ? range.start : range.end };
    }
    let moving: ReadmeBlock | undefined;
    if (drag.kind === "preset") {
      const preset = PRESETS.find((p) => p.id === drag.id);
      if (preset && list.length >= MAX_BLOCKS) announce(limitNote);
      else if (preset) moving = makeBlock(preset.block);
    } else moving = list.find((b) => b.id === drag.id);
    if (moving) {
      const next = placeBlock(list, moving, at);
      if (!sameLayout(next, list)) {
        setBlocks(next);
        setSelected(moving.id);
        announce(placed(next, moving, drag.kind === "preset" ? "Added" : "Moved"));
      }
    }
    endDrag();
  }
  // Dropping a block where it already is changes nothing, so don't promise a move with an indicator.
  const dragged = drag?.kind === "block" ? blocks.find((b) => b.id === drag.id) : undefined;
  const showTarget = target && !(dragged && sameLayout(placeBlock(blocks, dragged, target), blocks)) ? target : null;

  const inspector = () => {
    if (!current) return (
      <>
        <p className="eyebrow">Inspector</p>
        <h2 className={`panel-title ${e.inspectorTitle}`}>Nothing selected</h2>
        <p className={e.sub}>Click a card or a text block on the page to change how it looks.</p>
      </>
    );
    const b = current, at = blocks.findIndex((x) => x.id === b.id);
    const range = ranges.find((r) => at >= r.start && at < r.end);
    const inRow = Boolean(range && range.end - range.start > 1);
    const name = `${blockLabel(b)} (${at + 1} of ${total})`;
    // Swatches show the colour the card has in the theme the page is showing.
    const drawnIn: CardTheme = scheme;
    return (
      <>
        <p className="eyebrow">Block {at + 1} of {total}</p>
        <h2 className={`panel-title ${e.inspectorTitle}`}>{blockLabel(b)}</h2>
        {b.type === "text" ? (
          <>
            <p className={e.sub}>Type straight into the block on the page. GitHub reads it as Markdown.</p>
            <dl className={e.cheats}>
              <dt>## Title</dt><dd>Heading</dd>
              <dt>**bold**</dt><dd>Bold text</dd>
              <dt>- item</dt><dd>Bullet list</dd>
              <dt>[text](url)</dt><dd>Link</dd>
              <dt>---</dt><dd>Divider</dd>
            </dl>
          </>
        ) : (
          <div className={e.settings}>
            <label className={e.setting}>
              <span className={e.label}>Title</span>
              <input type="text" className={e.field} value={b.title ?? ""} placeholder={defaultCardTitle(b.provider)} maxLength={TITLE_MAX}
                spellCheck autoComplete="off" onChange={(ev) => patch(b.id, { title: ev.target.value || undefined })} />
            </label>
            {b.type === "harnesses" && (b.style ?? "classic") === "classic" && (
              <div className={e.setting}>
                <span className={e.label} id="insp-chart">Chart</span>
                <div className={e.opts} role="group" aria-labelledby="insp-chart">
                  {harnessCharts.map((c) => {
                    const on = (b.chart ?? "bar") === c;
                    return <button key={c} type="button" aria-pressed={on} className={`${e.opt} ${on ? e.optOn : ""}`}
                      onClick={() => patch(b.id, { chart: c === "bar" ? undefined : c })}>{CHART_LABELS[c]}</button>;
                  })}
                </div>
              </div>
            )}
            {stylesFor(b.type).length > 1 && <div className={e.setting}>
              <span className={e.label} id="insp-style">Style</span>
              <div className={e.opts} role="group" aria-labelledby="insp-style">
                {stylesFor(b.type).map((st) => (
                  <button key={st} type="button" aria-pressed={(b.style ?? "classic") === st} className={`${e.opt} ${(b.style ?? "classic") === st ? e.optOn : ""}`}
                    onClick={() => patch(b.id, { style: st })}>{STYLE_LABELS[st]}</button>
                ))}
              </div>
            </div>}
            <div className={e.setting}>
              <span className={e.label} id="insp-border">Border</span>
              <div className={e.opts} role="group" aria-labelledby="insp-border" aria-describedby="insp-border-help">
                {([["solid", "Border"], ["none", "No border"]] as const).map(([value, label]) => {
                  const on = (b.border ?? "solid") === value;
                  return (
                    <button key={value} type="button" aria-pressed={on} className={`${e.opt} ${on ? e.optOn : ""}`}
                      onClick={() => patch(b.id, { border: value === "none" ? "none" : undefined })}>{label}</button>
                  );
                })}
              </div>
              <p id="insp-border-help" className={e.hint}>
                {b.border === "none" ? "No background or outline: only the text shows, on whatever is behind it." : "A card with its own background and outline."}
              </p>
            </div>
            <div className={e.setting}>
              <span className={e.label} id="insp-accent">Accent · {ACCENTS[b.accent ?? "lime"].label}</span>
              <div className={e.swatches} role="group" aria-labelledby="insp-accent">
                {cardAccents.map((ac) => (
                  <button key={ac} type="button" aria-label={ACCENTS[ac].label} aria-pressed={(b.accent ?? "lime") === ac}
                    className={`${e.swatch} ${(b.accent ?? "lime") === ac ? e.swatchOn : ""}`} onClick={() => patch(b.id, { accent: ac })}>
                    <span style={{ background: accentColor(ac, drawnIn) }} />
                  </button>
                ))}
              </div>
            </div>
            {b.type === "trend" && (
              <>
                <div className={e.setting}>
                  <span className={e.label} id="insp-days">Range</span>
                  <div className={e.opts} role="group" aria-labelledby="insp-days">
                    {trendDays.map((d) => {
                      const on = (b.days ?? 90) === d;
                      return <button key={d} type="button" aria-pressed={on} className={`${e.opt} ${on ? e.optOn : ""}`}
                        onClick={() => patch(b.id, { days: d === 90 ? undefined : d })}>{DAY_LABELS[d]}</button>;
                    })}
                  </div>
                </div>
                <div className={e.setting}>
                  <span className={e.label} id="insp-measure">Measure</span>
                  <div className={e.opts} role="group" aria-labelledby="insp-measure">
                    {trendMeasures.map((m) => {
                      const on = (b.measure ?? "tokens") === m;
                      return <button key={m} type="button" aria-pressed={on} className={`${e.opt} ${on ? e.optOn : ""}`}
                        onClick={() => patch(b.id, { measure: m === "tokens" ? undefined : m })}>{MEASURE_LABELS[m]}</button>;
                    })}
                  </div>
                </div>
              </>
            )}
            {b.type === "usage" && (
              <div className={e.setting}>
                <span className={e.label} id="insp-metrics">Metrics · up to {maxMetrics(b.provider)}</span>
                <div className={e.opts} role="group" aria-labelledby="insp-metrics">
                  {cardMetrics.map((m) => {
                    const on = b.metrics.includes(m);
                    return (
                      <button key={m} type="button" aria-pressed={on} className={`${e.opt} ${on ? e.optOn : ""}`}
                        disabled={on ? b.metrics.length === 1 : b.metrics.length >= maxMetrics(b.provider)}
                        onClick={() => patch(b.id, { metrics: toggleMetric(b.metrics, m) })}>
                        {METRIC_LABELS[m]}
                      </button>
                    );
                  })}
                </div>
                {b.metrics.length > 1 && (
                  <MetricOrder metrics={b.metrics} spotlight={b.style === "spotlight"} onChange={(metrics) => patch(b.id, { metrics })} />
                )}
                <div className={e.order}>
                  <span className={e.label} id="insp-labels">Labels</span>
                  {b.metrics.map((m) => (
                    <input key={m} type="text" className={e.field} aria-label={`Label under ${METRIC_LABELS[m]}`} placeholder={DEFAULT_LABELS[m]}
                      value={b.labels?.[m] ?? ""} maxLength={LABEL_MAX} spellCheck autoComplete="off"
                      onChange={(ev) => {
                        const next = { ...b.labels, [m]: ev.target.value };
                        if (!ev.target.value) delete next[m];
                        patch(b.id, { labels: Object.keys(next).length ? next : undefined });
                      }} />
                  ))}
                  <p className={e.hint}>The line under each number. Leave one empty for the usual wording; the numbers themselves can&apos;t be changed.</p>
                </div>
              </div>
            )}
            <label className={e.setting}>
              <span className={e.label}>Typography</span>
              <span className={`select-pill ${e.select}`}>
                <select value={b.font ?? "system"} onChange={(ev) => patch(b.id, { font: ev.target.value as CardFont })}>
                  {cardFonts.map((f) => <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{FONT_LABELS[f]}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden />
              </span>
            </label>
            <div className={e.setting}>
              <span className={e.label} id="insp-animation">Animation</span>
              <div className={e.opts} role="group" aria-labelledby="insp-animation">
                {cardAnimations.map((a) => {
                  const on = (b.animation ?? "none") === a;
                  return <button key={a} type="button" aria-pressed={on} title={ANIMATION_HINTS[a]} className={`${e.opt} ${on ? e.optOn : ""}`}
                    onClick={() => patch(b.id, { animation: a === "none" ? undefined : a })}>{ANIMATION_LABELS[a]}</button>;
                })}
              </div>
            </div>
            <div className={`${e.setting} ${e.sizing}`}>
              <label className={e.setting}>
                <span className={e.labelRow}><span className={e.label}>Width</span><output className={e.label}>{widthOf(b)} px</output></span>
                <input type="range" className={e.range} min={MIN_WIDTH} max={maxWidthFor(blocks, b.id)} step={10} value={widthOf(b)}
                  aria-valuetext={`${widthOf(b)} pixels`} onChange={(ev) => setBlocks((all) => resizeBlock(all, b.id, Number(ev.target.value)))} />
              </label>
              <div className={e.buttons}>
                {joinTarget(blocks, b.id) !== null && (
                  <button type="button" className="pill pill-sm" onClick={() => joinPrevious(b)}><Columns2 size={14} aria-hidden />Beside previous</button>
                )}
                {inRow && <button type="button" className="pill pill-sm" onClick={() => ownRow(b)}><Rows2 size={14} aria-hidden />Own row</button>}
                <button type="button" className="pill pill-sm" disabled={b.width === undefined} onClick={() => patch(b.id, { width: undefined })}>
                  <RotateCcw size={14} aria-hidden />Reset size
                </button>
              </div>
            </div>
          </div>
        )}
        <div className={e.footer}>
          <button type="button" className="round round-sm" data-act="up" aria-label={`Move ${name} ${inRow ? "left" : "up"}`}
            disabled={stepBlock(blocks, b.id, -1) === blocks} onClick={() => move(b, -1)}>
            {inRow ? <ArrowLeft size={16} /> : <ArrowUp size={16} />}
          </button>
          <button type="button" className="round round-sm" data-act="down" aria-label={`Move ${name} ${inRow ? "right" : "down"}`}
            disabled={stepBlock(blocks, b.id, 1) === blocks} onClick={() => move(b, 1)}>
            {inRow ? <ArrowRight size={16} /> : <ArrowDown size={16} />}
          </button>
          <span className={e.spacer} />
          <button type="button" className={`pill pill-sm ${e.danger}`} aria-label={`Remove ${name}`} onClick={() => remove(b)}>
            <Trash2 size={14} aria-hidden />Remove
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="shell">
      <TopNav selected="edit" home="/all" name="all" />
      <main>
        <header className="dash-head">
          <div>
            <p className="eyebrow">README editor</p>
            <h1 className="display">Build your <span className="accent">profile</span></h1>
          </div>
          <div className="dash-actions">
            {ready && <span className={e.saved}><Check size={14} aria-hidden />Saved in this browser</span>}
            <Link className="pill pill-filled" href="/preview" transitionTypes={["nav-forward"]}>
              Preview &amp; publish <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </header>

        <div className={e.workspace} {...(panelDragging ? { "data-resizing": "" } : {})}
          style={{ "--left": `${panels.leftOpen ? panels.left : RAIL_WIDTH}px`, "--right": `${panels.rightOpen ? panels.right : RAIL_WIDTH}px` } as CSSProperties}>
          <aside ref={boardRef} className={e.elements} {...(panels.leftOpen ? {} : { "data-collapsed": "" })} aria-label="Elements you can add to the README">
            <div className={e.rail}>
              <button type="button" className="round round-sm" aria-label="Expand Elements panel" aria-expanded={false} onClick={() => togglePanel("left")}>
                <PanelLeftOpen size={16} />
              </button>
              <span className={e.railLabel} aria-hidden="true">Elements</span>
            </div>
            <PanelHandle side="left" width={panels.left} onResize={(w) => resizePanel("left", w)} onActive={setPanelDragging} />
            <div className={e.panelBody}>
            <div className={e.panelHead}>
              <h2 className="panel-title">Elements</h2>
              <div className={e.panelTools}>
                <button type="button" className="round round-sm" aria-label="Refresh usage data" disabled={usage.busy} onClick={() => void usage.refresh()}>
                  <RefreshCw size={14} className={usage.busy ? "spin" : ""} />
                </button>
                <button type="button" className={`round round-sm ${e.collapseBtn}`} aria-label="Collapse Elements panel" aria-expanded={true} onClick={() => togglePanel("left")}>
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </div>
            <p className={e.sub}>Drag onto the page, or press +. Then change its look in the Inspector. Cards show your usage, or sample data where none is recorded yet.</p>
            {full && <p className={`${e.sub} ${e.limit}`}>{limitNote}</p>}
            <label className={e.filter}>
              <span className={e.label}>Show cards for</span>
              <span className={`select-pill ${e.select}`}>
                <select value={boardFilter} onChange={(ev) => setBoardFilter(ev.target.value as CardProvider)}>
                  {(["all", ...PROVIDERS] as CardProvider[]).map((f) => <option key={f} value={f}>{providerName(f)}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden />
              </span>
            </label>
            {PRESET_GROUPS.map((group) => {
              const GroupIcon = GROUP_ICONS[group];
              const items = PRESETS.filter((p) => p.group === group && isOffered(p) && (!p.provider || p.provider === boardFilter));
              if (!items.length) return null;
              return (
                <section key={group} className={e.group}>
                  <h3 className={e.groupTitle}><GroupIcon size={14} aria-hidden /><span className="eyebrow">{GROUP_LABELS[group]}</span></h3>
                  <ul>
                    {items.map((p, n) => {
                      const source = p.provider ? thumbSource(p.provider) : null;
                      const sample = p.block.type === "text" ? p.block.text.split("\n")[0] || "Write anything" : "";
                      return (
                        <li key={p.id} className={e.preset} draggable onDragStart={startDrag({ kind: "preset", id: p.id })} onDragEnd={endDrag}>
                          <div className={e.presetHead}>
                            <GripVertical size={14} aria-hidden className={e.grip} />
                            <span className={e.presetText}>
                              <span className={e.presetTitle}>{group === "Markdown" ? "Markdown" : p.title}</span>
                              <small className={sample ? e.mono : undefined}>
                                {sample || p.hint}{source?.sample && source.snapshot ? " · sample data" : ""}
                              </small>
                            </span>
                            <button type="button" className="round round-sm"
                              aria-label={group === "Markdown" ? "Add Markdown" : `Add ${p.title}${GROUP_NOUN[group]}`}
                              disabled={full} title={full ? limitNote : undefined} {...(group === PRESET_GROUPS[0] && n === 0 ? { "data-board-first": "" } : {})}
                              onClick={() => add(p)}><Plus size={16} /></button>
                          </div>
                          {p.block.type !== "text" && (
                            <div className={e.thumb} aria-hidden="true"><PresetThumb preset={p} snapshot={source?.snapshot ?? null} scheme={scheme} /></div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            </div>
          </aside>

          <section className={e.canvas} aria-label="README page">
            <div className={e.canvasHead}>
              <span className={e.path}>{username || "username"}<span>/</span>README<span>.md</span></span>
              <span className={e.meta}>{total} {total === 1 ? "block" : "blocks"} · 800 px column</span>
              <div className={`segmented ${e.pageToggle}`} role="group" aria-label="Show the page as">
                {(["light", "dark"] as CardTheme[]).map((t) => (
                  <button key={t} type="button" aria-pressed={scheme === t} className={scheme === t ? "selected" : ""} onClick={() => setPagePick(t)}>
                    GitHub {t}
                  </button>
                ))}
              </div>
            </div>
            <PreviewBoundary fallback={<p className={e.failed}>This page could not be drawn. Your README is unchanged; try reloading.</p>}>
              <div ref={bodyRef} className={`${e.sheet} ${scheme === "dark" ? e.sheetDark : ""}`} onDragLeave={leave}
                onClick={(ev) => { if (ev.target === ev.currentTarget) setSelected(null); }}>
                {ready && total === 0 && (
                  <div className={`${e.empty} ${drag ? e.armed : ""}`} onDragOver={overEnd} onDrop={drop}>
                    <p className="display-s">Start with a card</p>
                    <p>Drag one in from Elements, or press + next to it.</p>
                  </div>
                )}
                {ranges.map((range) => (
                  <div key={blocks[range.start].id} className={e.row} data-row onDragOver={overRow(range)} onDrop={drop}>
                    {showTarget && "slot" in showTarget && showTarget.slot === range.start && <span className={e.insert} aria-hidden />}
                    {blocks.slice(range.start, range.end).map((b, k) => {
                      const i = range.start + k, isSelected = b.id === selected;
                      return (
                        // Clicking anywhere on a block selects it; its name button is the keyboard equivalent.
                        <div key={b.id} data-block-id={b.id} onDragOver={overBlock(b, i)} onClick={() => setSelected(b.id)}
                          className={`${e.block} ${b.type === "text" ? e.textBlock : ""} ${isSelected ? e.selected : ""} ${drag?.kind === "block" && drag.id === b.id ? e.dragging : ""}`}
                          style={b.type === "text" ? undefined : { width: `${(widthOf(b) / ROW_BUDGET) * 100}%` }}>
                          {showTarget && "beside" in showTarget && showTarget.beside === b.id &&
                            <span className={`${e.insertSide} ${showTarget.side === "left" ? e.insertLeft : e.insertRight}`} aria-hidden />}
                          <div className={e.blockBar}>
                            <span className={e.handle} draggable onDragStart={startDrag({ kind: "block", id: b.id })} onDragEnd={endDrag}
                              title="Drag to move" aria-hidden="true"><GripVertical size={14} /></span>
                            <button type="button" className={e.blockName} data-select aria-pressed={isSelected}
                              aria-label={`Select ${blockLabel(b)}, block ${i + 1} of ${total}`}
                              onClick={(ev) => { ev.stopPropagation(); setSelected(b.id); }}>
                              {blockLabel(b)}
                            </button>
                          </div>
                          {b.type === "text" ? (
                            <textarea className={e.text} aria-label={`Markdown text, block ${i + 1} of ${total}`} spellCheck value={b.text}
                              placeholder="Write Markdown…" maxLength={MAX_TEXT} rows={Math.max(2, b.text.split("\n").length + 1)}
                              onFocus={() => setSelected(b.id)}
                              onChange={(ev) => { const text = ev.target.value; setBlocks((all) => all.map((x) => (x.id === b.id ? { ...x, text } : x))); }} />
                          ) : (
                            <div className={`${e.cardFrame} ${resizing === b.id ? e.resizing : ""}`}>
                              <WidgetPreview block={b} snapshot={snapshotOf(b.provider)} status={statusOf(b.provider)} error={errorOf(b.provider)} scheme={scheme} />
                              {b.type === "usage" && b.metrics.length > 1 && snapshotOf(b.provider) && (
                                <MetricDrag snapshot={snapshotOf(b.provider)!} provider={b.provider} metrics={b.metrics} style={b.style} labels={b.labels}
                                  onChange={(metrics) => patch(b.id, { metrics })} />
                              )}
                              <span className={e.sizeTag} aria-hidden="true">{widthOf(b)} px</span>
                              <span className={e.resize} aria-hidden="true" title="Drag to resize" onPointerDown={startResize(b)} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {total > 0 && (
                  <div className={`${e.tail} ${drag ? e.armed : ""}`} onDragOver={overEnd} onDrop={drop}>
                    {showTarget && "slot" in showTarget && showTarget.slot === total && <span className={e.insert} aria-hidden />}
                    Drop an element here
                  </div>
                )}
              </div>
            </PreviewBoundary>
          </section>

          <aside ref={inspectorRef} className={e.inspector} {...(panels.rightOpen ? {} : { "data-collapsed": "" })} aria-label="Selected block settings">
            <div className={e.rail}>
              <button type="button" className="round round-sm" aria-label="Expand Inspector panel" aria-expanded={false} onClick={() => togglePanel("right")}>
                <PanelRightOpen size={16} />
              </button>
              <span className={e.railLabel} aria-hidden="true">Inspector</span>
            </div>
            <PanelHandle side="right" width={panels.right} onResize={(w) => resizePanel("right", w)} onActive={setPanelDragging} />
            <div className={e.panelBody}>
              <div className={e.panelTools}>
                <button type="button" className={`round round-sm ${e.collapseBtn}`} aria-label="Collapse Inspector panel" aria-expanded={true} onClick={() => togglePanel("right")}>
                  <PanelRightClose size={16} />
                </button>
              </div>
              {inspector()}
            </div>
          </aside>
        </div>
      </main>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  );
}
