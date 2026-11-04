"use client";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import ProviderNavigation from "./provider-navigation";
import type { UsageProvider } from "@/lib/types";

// Chart colours. Categorical slots in a fixed order, checked with the dataviz palette
// validator on the white page surface (adjacent pairs pass colour-blind separation).
// Slot 1 is the brand accent. Never cycle past the last slot: fold the rest into OTHER.
export const SERIES = ["#ff4901", "#2a78d6", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const OTHER = "#767676";
export const ACCENT = SERIES[0];
export const INK = "#121212";
export const MUTED = "#767676";
export const GRID = "#dedfe1";

export const tooltipStyle = {
  background: "#ffffff",
  border: `1px solid ${INK}`,
  borderRadius: 4,
  color: INK,
  fontSize: 14,
  boxShadow: "none",
};
export const axisTick = { fill: MUTED, fontSize: 12 };

// Sticky frosted nav: wordmark, product links, one CTA. It slides away while scrolling down and
// comes back on any scroll up.
export function TopNav({ selected, home, name }: { selected: UsageProvider | "all" | "edit"; home: string; name: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const header = ref.current;
      if (!header) return;
      if (y > last && y > header.offsetHeight) header.dataset.hidden = "";
      else if (y < last) delete header.dataset.hidden;
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className="topnav" ref={ref} style={{ viewTransitionName: "site-header" }}>
      <Link className="wordmark" href={home} aria-label={`${name} Vibe Check home`}>
        {name}<span>vibe check</span>
      </Link>
      <div className="topnav-links"><ProviderNavigation selected={selected} /></div>
      <div className="topnav-cta">
        <Link className={`pill pill-sm ${selected === "edit" ? "pill-filled" : ""}`} href="/edit" transitionTypes={["nav-forward"]}
          aria-current={selected === "edit" ? "page" : undefined}>
          Edit README
        </Link>
        <Link className="pill pill-filled pill-sm" href="/setup" transitionTypes={["nav-forward"]}
          aria-label="Put your usage on your GitHub profile">
          Put on GitHub
        </Link>
      </div>
    </header>
  );
}

// Uppercase display headline that rises word by word. One phrase can carry the accent colour.
export function Headline({ text, accent, as: Tag = "h1", className = "" }: {
  text: string; accent?: string; as?: "h1" | "h2"; className?: string;
}) {
  let index = 0;
  const words = (part: string, accented: boolean) =>
    part.split(/\s+/).filter(Boolean).map((word) => {
      const i = index++;
      return (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="word-mask">
            <span className={`word ${accented ? "accent" : ""}`} style={{ "--i": i } as React.CSSProperties}>{word}</span>
          </span>
        </Fragment>
      );
    });
  const [before, after] = accent ? text.split(accent) : [text, ""];
  return (
    <Tag className={`display ${className}`} data-reveal="words">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words(before, false)}
        {accent && words(accent, true)}
        {after && words(after, false)}
      </span>
    </Tag>
  );
}

// Panel heading: uppercase 900 with one accented phrase.
export function PanelTitle({ text, accent, id }: { text: string; accent?: string; id?: string }) {
  const [before, after] = accent ? text.split(accent) : [text, ""];
  return (
    <h2 className="panel-title" id={id}>
      {before}{accent && <span className="accent">{accent}</span>}{after}
    </h2>
  );
}

// Reveals each [data-reveal] element once, when 10% of it is on screen. Elements added later
// (after data loads) are picked up too. CSS only hides elements once this has started, so the
// page stays readable without JavaScript, and reduced motion turns every reveal into a fade.
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // Once its entrance has played, a panel is marked settled. The chart library replaces a bar
    // whenever its value or position changes (every refresh), and a replaced bar would otherwise
    // replay its entrance keyframe; settled panels skip it.
    const timers = new Set<number>();
    const reveal = (node: HTMLElement) => {
      node.dataset.in = "";
      const t = window.setTimeout(() => {
        timers.delete(t);
        node.dataset.settled = "";
      }, SETTLE_MS);
      timers.add(t);
    };
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target as HTMLElement);
        io.unobserve(entry.target);
      }
    }, { threshold: 0.1 });
    // Tracked per observer (not on the element), so a re-run effect observes everything again.
    const watched = new WeakSet<Element>();
    const scan = () =>
      el.querySelectorAll("[data-reveal]:not([data-in])").forEach((node) => {
        if (watched.has(node)) return;
        watched.add(node);
        io.observe(node);
      });
    // Whatever is on screen before motion starts was painted by the server and has already been
    // seen. Hiding it to animate it back in would only make it blink, so it stays put.
    if (!el.hasAttribute("data-motion"))
      el.querySelectorAll<HTMLElement>("[data-reveal]:not([data-in])").forEach((node) => {
        const box = node.getBoundingClientRect();
        if (box.top < window.innerHeight && box.bottom > 0) reveal(node);
      });
    scan();
    el.setAttribute("data-motion", "");
    const mo = new MutationObserver(scan);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      timers.forEach((t) => clearTimeout(t));
    };
  }, [root]);
}
// Longest panel entrance (24 staggered bars: 0.25s delay + 23 × 30ms + 0.9s), with room for the
// chart to draw a frame late.
const SETTLE_MS = 2_500;

// A formatted figure ("1.2B", "$88.61", "1,204") that counts up from zero the first time it
// scrolls into view, then glides between values when a refresh changes it. Text that isn't a
// number, or a change of unit (K to M), just swaps. Screen readers only get the final value.
const NUMERIC = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/;
type Figure = { prefix: string; n: number; decimals: number; grouped: boolean; suffix: string };
function parseFigure(text: string): Figure | null {
  const m = NUMERIC.exec(text);
  if (!m) return null;
  return {
    prefix: m[1],
    n: Number(m[2].replace(/,/g, "")),
    decimals: m[2].split(".")[1]?.length ?? 0,
    grouped: m[2].includes(","),
    suffix: m[3],
  };
}
function formatFigure(f: Figure, n: number) {
  return f.prefix + n.toLocaleString("en-US", {
    minimumFractionDigits: f.decimals,
    maximumFractionDigits: f.decimals,
    useGrouping: f.grouped,
  }) + f.suffix;
}
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

export function CountUp({ value, duration = 1400 }: { value: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  // An in-between frame, tagged with the value it is heading to so a stale frame never shows.
  const [frame, setFrame] = useState<{ to: string; text: string } | null>(null);
  const revealed = useRef(false);
  const last = useRef<Figure | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    const target = parseFigure(value);
    const previous = last.current;
    last.current = target;
    if (!target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tween = (from: number, ms: number) => {
      cancelAnimationFrame(raf.current);
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        setFrame(t < 1 ? { to: value, text: formatFigure(target, from + (target.n - from) * easeOutQuart(t)) } : null);
        if (t < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    };
    if (revealed.current) {
      const sameUnit = previous && previous.prefix === target.prefix && previous.suffix === target.suffix;
      if (sameUnit && previous.n !== target.n) tween(previous.n, 700);
      return;
    }
    const el = ref.current;
    if (!el) return;
    // Server-painted figures on screen keep their value instead of restarting from 0. Child
    // effects run before useReveal's, so a shell without data-motion means this is the first
    // render after the server's HTML; figures that arrive later still count up.
    const box = el.getBoundingClientRect();
    if (!el.closest("[data-motion]") && box.top < window.innerHeight && box.bottom > 0) {
      revealed.current = true;
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      revealed.current = true;
      tween(0, duration);
    }, { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <>
      <span className="sr-only">{value}</span>
      <span className="count" ref={ref} aria-hidden="true">
        {frame && frame.to === value ? frame.text : value}
      </span>
    </>
  );
}

// One hover card for the whole dashboard, anchored above whatever is being pointed at (or below,
// when there's no room). Fixed positioning keeps it clear of scrolling containers; it hides on
// any scroll because the anchor has moved. On touch there is no hover to end, so a tapped card
// stays until the next tap elsewhere. Render <HoverTip> once, directly inside .shell.
type Tip = { x: number; top: number; bottom: number; content: ReactNode; anchor: Element };
export function useHoverTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback((anchor: Element, content: ReactNode) => {
    const r = anchor.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom, content, anchor });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  // For pointer-leave handlers: a lifted finger also "leaves", but should keep its card.
  const leave = useCallback((e: React.PointerEvent) => { if (e.pointerType !== "touch") setTip(null); }, []);
  useEffect(() => {
    if (!tip) return;
    const tapAway = (e: PointerEvent) => { if (!tip.anchor.contains(e.target as Node)) setTip(null); };
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("pointerdown", tapAway);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("pointerdown", tapAway);
    };
  }, [tip, hide]);
  return { tip, show, hide, leave };
}

export function HoverTip({ tip }: { tip: Tip | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // Measured after render: keep the card 8px inside the viewport and flip it below the anchor
  // when it would run off the top.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(tip.x - width / 2, 8), window.innerWidth - width - 8);
    const above = tip.top - height - 8 >= 8;
    el.style.left = `${left}px`;
    el.style.top = `${above ? tip.top - height - 8 : tip.bottom + 8}px`;
    el.dataset.side = above ? "above" : "below";
  }, [tip]);
  if (!tip) return null;
  return <div className="hover-tip" role="tooltip" ref={ref}>{tip.content}</div>;
}

// For share bars: the index of the segment nearest the pointer, so the whole bar (gaps and
// thin slivers included) is one easy hover target.
export function nearestSegment(bar: Element, clientX: number) {
  let best = -1, gap = Infinity;
  [...bar.children].forEach((segment, i) => {
    const r = segment.getBoundingClientRect();
    const d = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
    if (d < gap) { gap = d; best = i; }
  });
  return best;
}
