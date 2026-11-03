"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ExternalLink,
  Info,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CardProvider, MetricAvailability, UsageProvider, UsageSnapshot } from "@/lib/types";
import { PROVIDERS, providerName } from "@/lib/providers";
import { biggestWindow, hasHistory, loadHarnesses, mergeHarnesses, metricAvailable, summarizeHarnesses } from "@/lib/overview";
import type { HarnessUsage } from "@/lib/overview";
import { modelLabel } from "@/lib/model-label";
import { ACCENT, CountUp, GRID, Headline, HoverTip, OTHER, PanelTitle, SERIES, TopNav, axisTick, nearestSegment, tooltipStyle, useHoverTip, useReveal } from "./vibe-check-chrome";
const compact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const number = (n: number) => new Intl.NumberFormat("en-US").format(n);
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
const dateLabel = (s: string) =>
  new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const DONUT_MIN_ANGLE = 1;
const shareText = (value: number, total: number) => {
  const share = total ? (value / total) * 100 : 0;
  return share > 0 && share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`;
};
const dayInZone = (timestamp: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
const ALL_AVAILABLE = {
  tokens: true,
  cost: true,
  sessions: true,
  humanRequests: true,
  assistantRequests: true,
  cacheBreakdown: true,
};
type Range = "All time" | "Last 30 days" | "Last 7 days";
// On the All page each harness keeps its own colour slot, so its colour never changes when others are missing.
const HARNESS_COLORS = Object.fromEntries(PROVIDERS.map((p, i) => [p, SERIES[i]])) as Record<UsageProvider, string>;
const harnessHref = (p: UsageProvider) => (p === "codex" ? "/" : `/${p}`);

// Hover card for the stacked All trend. Recharts' default colours each row with the series stroke,
// which is white here (the divider between layers), so the numbers would be invisible.
function HarnessTooltip({ active, payload, label, metric }: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Record<string, number | string> }>;
  label?: string | number;
  metric: "tokens" | "cost";
}) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;
  const amount = (p: UsageProvider) => Number(day[`${p}_${metric}`] ?? 0);
  const format = (v: number) => (metric === "tokens" ? number(v) : money(v));
  const rows = PROVIDERS.filter((p) => amount(p) > 0);
  const total = rows.reduce((sum, p) => sum + amount(p), 0);
  const date = new Date(`${label}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <div className="daily-tooltip" style={tooltipStyle}>
      <p className="daily-tooltip-date">{date}</p>
      {rows.length === 0 ? <p className="daily-tooltip-empty">No recorded {metric === "tokens" ? "tokens" : "value"}</p> : (
        <ul>
          {rows.map((p) => (
            <li key={p}>
              <span className="swatch" style={{ background: HARNESS_COLORS[p] }} />
              <span>{providerName(p)}</span>
              <strong>{format(amount(p))}</strong>
            </li>
          ))}
          {rows.length > 1 && <li className="daily-tooltip-total"><span /><span>Total</span><strong>{format(total)}</strong></li>}
        </ul>
      )}
    </div>
  );
}

export default function Dashboard({
  provider = "codex",
  initial,
  initialHarnesses,
  initialStale = false,
}: {
  // "all" draws every harness at once from a merged snapshot.
  provider?: CardProvider;
  // Usage the server already had, so the page arrives filled in. Missing: load it here.
  initial?: UsageSnapshot;
  initialHarnesses?: HarnessUsage[];
  initialStale?: boolean;
}) {
  const isAll = provider === "all",
    isClaude = provider === "claude",
    isCursor = provider === "cursor",
    isAntigravity = provider === "antigravity",
    // Imported or retained history can end well before today, so ranges and
    // the calendar anchor to the last recorded event instead of the wall clock.
    anchorToLastEvent = isCursor || isAntigravity,
    product = isAll
      ? "connected harnesses"
      : isClaude
      ? "Claude Code"
      : isCursor
        ? "Cursor"
        : isAntigravity
          ? "Antigravity"
          : "Codex",
    brand = provider,
    accent = ACCENT;

  const router = useRouter();
  const shellRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  useReveal(shellRef);
  const [single, setData] = useState<UsageSnapshot | null>(initial ?? null),
    // All only: each harness's own result, merged into `data` below.
    [harnesses, setHarnesses] = useState<HarnessUsage[] | null>(initialHarnesses ?? null),
    // All only: the harness being pointed at, in the share bar or its table row.
    [harnessOn, setHarnessOn] = useState<UsageProvider | null>(null),
    [stale, setStale] = useState(initialStale),
    [error, setError] = useState(""),
    [locked, setLocked] = useState(false),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [range, setRange] = useState<Range>("All time"),
    [info, setInfo] = useState(false),
    [metricChoice, setMetric] = useState<"tokens" | "cost">("tokens"),
    [year, setYear] = useState<number | null>(null),
    // Hover highlights: a model in the mix bar, a slice of the donut.
    [mixOn, setMixOn] = useState<string | null>(null),
    [hoodOn, setHoodOn] = useState<number | null>(null);
  const tip = useHoverTip();
  const data = useMemo(
    () => (isAll ? (harnesses ? mergeHarnesses(harnesses) : null) : single),
    [isAll, harnesses, single],
  );
  const overview = useMemo(() => summarizeHarnesses(harnesses ?? []), [harnesses]);
  const failures = isAll ? (harnesses ?? []).filter((h) => h.error) : [];
  const availability = data?.availability ?? ALL_AVAILABLE;
  const metric =
    metricChoice === "cost" && !availability.cost ? "tokens" : metricChoice;
  const refresh = useCallback(async () => {
    setBusy(true);
    // A brand-new deployment has no password yet: send its first visitor to setup.
    const toSetupIfUnclaimed = () =>
      void fetch("/api/setup/status", { cache: "no-store" })
        .then((r) => r.json())
        .then((s) => {
          if (s?.cloud && s.storage === "ok" && !s.claimed) router.push("/setup");
        })
        .catch(() => {});
    try {
      if (provider === "all") {
        // Each harness loads on its own; a failed one is reported, not fatal.
        const result = await loadHarnesses();
        if (result.locked) {
          setLocked(true);
          setHarnesses(null);
          toSetupIfUnclaimed();
          return;
        }
        setHarnesses(result.harnesses);
        setStale(result.stale);
        setLocked(false);
        setError("");
        return;
      }
      const response = await fetch(`/api/usage?provider=${provider}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        setLocked(true);
        toSetupIfUnclaimed();
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load usage.");
      if ((body.provider || "codex") !== provider)
        throw new Error(
          "Received usage for a different product. Try refreshing.",
        );
      setData(body);
      setStale(response.headers.get("X-Usage-Stale") === "1");
      setLocked(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }, [provider, router]);
  const loadedOnServer = useRef(Boolean(initial || initialHarnesses));
  useEffect(() => {
    if (loadedOnServer.current) return;
    const first = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(first);
  }, [refresh]);
  // A stale snapshot was saved by an earlier run while this one re-reads history: check back
  // often so the fresh numbers replace it as soon as they are ready.
  useEffect(() => {
    const id = setInterval(() => void refresh(), stale ? 2_000 : 15_000);
    return () => clearInterval(id);
  }, [refresh, stale]);
  const filtered = useMemo(() => {
    if (!data) return [];
    const end = new Date(
      anchorToLastEvent && data.coverage.lastEvent
        ? data.coverage.lastEvent
        : data.generatedAt,
    );
    const cutoff =
      range === "All time"
        ? ""
        : new Intl.DateTimeFormat("en-CA", {
            timeZone: data.timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(
            new Date(
              end.getTime() - (range === "Last 7 days" ? 6 : 29) * 86_400_000,
            ),
          );
    return data.daily.filter((d) => !cutoff || d.date >= cutoff);
  }, [data, range, anchorToLastEvent]);
  const activity = useMemo(() => {
    if (!data) return [];
    const selectedYear =
      year ??
      Number(
        dayInZone(
          anchorToLastEvent && data.coverage.lastEvent
            ? data.coverage.lastEvent
            : data.generatedAt,
          data.timezone,
        ).slice(0, 4),
      );
    const end = new Date(Date.UTC(selectedYear, 11, 31)),
      start = new Date(Date.UTC(selectedYear, 0, 1));
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const map = new Map(data.daily.map((d) => [d.date, d]));
    const days = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10),
        item = map.get(key);
      days.push({
        date: key,
        tokens: item?.totalTokens || 0,
        requests: item?.humanRequests || 0,
        // Cursor pairs a token export that may cover only part of the history
        // with local activity metadata, so a day counts if either recorded it.
        active: (item?.totalTokens || 0) > 0 || (item?.humanRequests || 0) > 0,
        future: key > dayInZone(data.generatedAt, data.timezone),
      });
    }
    return days;
  }, [data, year, anchorToLastEvent]);
  const calendarYear =
    year ??
    (data
      ? Number(
          dayInZone(
            anchorToLastEvent && data.coverage.lastEvent
              ? data.coverage.lastEvent
              : data.generatedAt,
            data.timezone,
          ).slice(0, 4),
        )
      : null);
  useEffect(() => {
    const el = heatmapRef.current;
    if (el && window.innerWidth < 768) el.scrollLeft = el.scrollWidth;
  }, [calendarYear]);
  useEffect(() => {
    if (!info) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInfo(false);
      if (e.key === "Tab") {
        const focusable = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".modal button, .modal a[href]",
          ),
        );
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [info]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setPassword("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(isAll ? { harnesses } : data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${brand}-vibe-check-${data.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const totals = data?.totals,
    models = data?.models || [],
    // Cursor tokens are exported separately from local activity, so the
    // calendar is scaled by human requests whenever those are recorded.
    byRequests = isCursor && availability.humanRequests,
    maxDay = Math.max(
      1,
      ...activity.map((d) => (byRequests ? d.requests : d.tokens)),
    );
  // Eight colour slots, never cycled. With more models than slots, the first seven keep a
  // colour and the rest share one "Other" segment in the bar.
  const folds = models.length > SERIES.length;
  const colorFor = (i: number) => (folds && i >= SERIES.length - 1 ? OTHER : SERIES[i]);
  const segments = folds
    ? [
        ...models.slice(0, SERIES.length - 1).map((m, i) => ({ key: m.model, label: modelLabel(m.model), tokens: m.totalTokens, color: colorFor(i) })),
        {
          key: "other",
          label: `Other models (${models.length - SERIES.length + 1})`,
          tokens: models.slice(SERIES.length - 1).reduce((sum, m) => sum + m.totalTokens, 0),
          color: OTHER,
        },
      ]
    : models.map((m, i) => ({ key: m.model, label: modelLabel(m.model), tokens: m.totalTokens, color: colorFor(i) }));
  // Tokens only exist for exported days, so divide by the sessions on those
  // same days rather than the whole retained history.
  const matchedTokens = (data?.daily || []).filter((d) => d.totalTokens > 0),
    matchedSessions = matchedTokens.reduce((sum, d) => sum + d.sessions, 0),
    matchedAverage = matchedSessions
      ? matchedTokens.reduce((sum, d) => sum + d.totalTokens, 0) /
        matchedSessions
      : 0;
  // All only: each harness's tokens and value per day, keyed `${harness}_${metric}` for the stacked trend.
  const harnessDaily = useMemo(() => {
    const days = new Map<string, Record<string, number>>();
    for (const { provider: p, snapshot } of isAll ? overview.connected : []) {
      const tokens = metricAvailable(snapshot, "tokens"), cost = metricAvailable(snapshot, "cost");
      for (const d of snapshot.daily) {
        const row = days.get(d.date) ?? {};
        if (tokens) row[`${p}_tokens`] = (row[`${p}_tokens`] ?? 0) + d.totalTokens;
        if (cost) row[`${p}_cost`] = (row[`${p}_cost`] ?? 0) + d.costUsd;
        days.set(d.date, row);
      }
    }
    return days;
  }, [isAll, overview]);
  const chart = useMemo(() => {
    if (!data) return [];
    const zero: Record<string, number> = isAll
      ? Object.fromEntries(PROVIDERS.flatMap((p) => [[`${p}_tokens`, 0], [`${p}_cost`, 0]]))
      : {};
    const end = new Intl.DateTimeFormat("en-CA", {
      timeZone: data.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(
      new Date(
        anchorToLastEvent && data.coverage.lastEvent
          ? data.coverage.lastEvent
          : data.generatedAt,
      ),
    );
    const start =
      range === "All time"
        ? data.daily[0]?.date
        : new Intl.DateTimeFormat("en-CA", {
            timeZone: data.timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(
            new Date(
              Date.parse(
                anchorToLastEvent && data.coverage.lastEvent
                  ? data.coverage.lastEvent
                  : data.generatedAt,
              ) -
                (range === "Last 7 days" ? 6 : 29) * 86_400_000,
            ),
          );
    if (!start) return [];
    const byDay = new Map(filtered.map((d) => [d.date, d])),
      result = [];
    for (
      let t = Date.parse(start + "T12:00:00Z");
      t <= Date.parse(end + "T12:00:00Z");
      t += 86_400_000
    ) {
      const key = new Date(t).toISOString().slice(0, 10),
        d = byDay.get(key);
      result.push({
        ...zero,
        ...harnessDaily.get(key),
        date: key,
        tokens: d?.totalTokens || 0,
        cost: d?.costUsd || 0,
      });
    }
    return result;
  }, [data, filtered, range, anchorToLastEvent, isAll, harnessDaily]);
  const inputBreakdown = totals
    ? [
        {
          name: "Cached input",
          value: totals.cachedInputTokens,
          color: SERIES[0],
        },
        {
          name: "Cache writes",
          value: totals.cacheWriteTokens,
          color: SERIES[1],
        },
        {
          name: "Fresh input",
          value:
            totals.inputTokens -
            totals.cachedInputTokens -
            totals.cacheWriteTokens,
          color: SERIES[2],
        },
        { name: "Output", value: totals.outputTokens, color: SERIES[3] },
      ].filter((d) => d.value > 0)
    : [];
  const activeDays = data
    ? data.daily.filter(
        (d) =>
          (d.totalTokens > 0 || (byRequests && d.humanRequests > 0)) &&
          d.date.startsWith(String(calendarYear)),
      ).length
    : 0;
  const hovered = hoodOn === null ? undefined : inputBreakdown[hoodOn];
  const showDay = (target: Element) => {
    const cell = target.closest<HTMLElement>("[data-i]");
    const d = cell && activity[Number(cell.dataset.i)];
    if (!cell || !d) return;
    tip.show(cell, (
      <>
        <div className="tip-title">
          {new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
        </div>
        {d.future ? <div className="tip-row">Still to come</div> : <>
          <div className="tip-row"><strong>{number(d.tokens)}</strong> tokens</div>
          {availability.humanRequests && <div className="tip-row"><strong>{number(d.requests)}</strong> human requests</div>}
        </>}
      </>
    ));
  };
  const powerValue = !data || !availability.cost
    ? "Unavailable"
    : data.mostExpensive24h
      ? money(data.mostExpensive24h.costUsd)
      : "—";
  // All only: which harness the power session comes from.
  const power = isAll ? biggestWindow(harnesses ?? []) : null;
  // All only: harnesses with a token share, in the same order as the share bar's segments.
  const shares = overview.connected
    .filter(({ snapshot }) => metricAvailable(snapshot, "tokens"))
    .map(({ provider: p, snapshot }) => ({ provider: p, tokens: snapshot.totals.totalTokens }));
  const harnessCount = overview.connected.length;
  return (
    <div className="shell" ref={shellRef}>
      <TopNav selected={provider} home={provider === "codex" ? "/" : `/${provider}`} name={brand} />
      <main id="overview">
        <header className="dash-head">
          <div>
            {isAll
              ? <Headline text="All your work, together." accent="together." />
              : <Headline text={`Your ${product} Usage`} accent={product} />}
          </div>
          <div className="dash-actions" data-reveal>
            <nav className="section-index" aria-label="Sections">
              <a href="#overview">Overview</a>
              {isAll && <a href="#harnesses">Harnesses</a>}
              <a href="#models">Models</a>
              <a href="#activity">Activity</a>
            </nav>
            <button className="pill pill-accent pill-sm" onClick={download} disabled={!data}>
              <ArrowDownToLine size={14} /> Export data
            </button>
            <button
              className="round round-sm"
              aria-label="Refresh usage"
              onClick={() => void refresh()}
              disabled={busy}
            >
              <RefreshCw size={14} className={busy ? "spin" : ""} />
            </button>
          </div>
        </header>
        {locked ? (
          <section className="notice-block login">
            <LockKeyhole size={24} />
            <h2 className="display-s">Your observatory is private.</h2>
            <p>Enter the dashboard password to see your usage.</p>
            <form onSubmit={login}>
              <input
                type="password"
                autoComplete="current-password"
                aria-label="Dashboard password"
                placeholder="Dashboard password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button className="pill pill-filled" disabled={busy}>
                Unlock <ArrowRight size={16} />
              </button>
            </form>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
        ) : (
          <>
            {error && (
              <div role="alert" className="error-banner">
                <Info size={16} />
                <span>
                  {error}
                  {data ? " Showing the last successful update." : ""}
                </span>
                <button className="text-link" onClick={() => void refresh()}>Try again</button>
              </div>
            )}
            {failures.length > 0 && (
              <div role="alert" className="error-banner">
                <Info size={16} />
                <span>
                  Partial overview: {failures.map((h) => providerName(h.provider)).join(", ")}{" "}
                  could not be loaded and {failures.length === 1 ? "is" : "are"} excluded from totals.
                </span>
                <button className="text-link" onClick={() => void refresh()} disabled={busy}>Try again</button>
              </div>
            )}
            {!data && !error ? (
              <section className="notice-block loading">
                <LoaderCircle className="spin" />
                <h2 className="display-s">Reading your {product} history</h2>
                <p>
                  Counting tokens. Your conversations stay on this machine.
                </p>
              </section>
            ) : (
              data &&
              totals && (
                <>
                  <section
                    className="stats"
                    aria-label="Statistics across recorded history"
                    data-reveal="items"
                  >
                    <Stat
                      index={1}
                      label="Total tokens"
                      value={
                        availability.tokens
                          ? compact(totals.totalTokens)
                          : "Unavailable"
                      }
                      detail={
                        availability.tokens ? (
                          <>
                            {compact(totals.inputTokens)} input ·{" "}
                            {compact(totals.outputTokens)} output
                          </>
                        ) : (
                          "Not reported by local activity records"
                        )
                      }
                      foot={
                        isCursor
                          ? "From your Cursor usage events"
                          : isAll
                            ? `Across ${harnessCount} ${harnessCount === 1 ? "harness" : "harnesses"} with history`
                            : "Across all recorded history"
                      }
                    />
                    <Stat
                      index={2}
                      label="API-equivalent value"
                      value={
                        availability.cost
                          ? money(totals.costUsd)
                          : "Unavailable"
                      }
                      detail={
                        <>
                          <span className="tag">Estimate</span> USD · current API rates
                        </>
                      }
                      foot={
                        !availability.cost
                          ? "Requires priced token records"
                          : totals.unpricedTokens > 0
                            ? `${compact(totals.unpricedTokens)} tokens have no cost estimate`
                            : "API bill equivalent"
                      }
                    />
                    <Stat
                      index={3}
                      label="Recorded sessions"
                      value={
                        availability.sessions
                          ? number(totals.sessions)
                          : "Unavailable"
                      }
                      detail={
                        availability.humanRequests ? (
                          <>
                            <strong>{number(totals.humanRequests)}</strong>{" "}
                            human requests
                          </>
                        ) : (
                          isAntigravity ? "No Antigravity history found" : "Human requests not included in this source"
                        )
                      }
                      foot={
                        availability.assistantRequests
                          ? `${number(totals.assistantRequests)} ${isCursor ? "usage events" : "model responses recorded"}`
                          : "Model response count unavailable"
                      }
                    />
                    <Stat
                      index={4}
                      label="Avg. tokens / session"
                      value={
                        availability.tokens && availability.sessions
                          ? byRequests
                            ? matchedSessions
                              ? compact(matchedAverage)
                              : "Unavailable"
                            : compact(totals.averageTokensPerSession)
                          : "Unavailable"
                      }
                      detail={
                        !availability.tokens ? "Model usage unavailable" : <>
                          <strong>{models.length}</strong>{" "}
                          {models.length === 1
                            ? "model explored"
                            : "models explored"}
                        </>
                      }
                      foot={
                        availability.tokens && availability.sessions
                          ? byRequests
                            ? "Tokens ÷ sessions on days with exported tokens"
                            : "Total tokens ÷ recorded sessions"
                          : "Requires matching token and session coverage"
                      }
                    />
                  </section>
                  {availability.tokens ? (
                    <div className={isAll ? "board board-all" : "board"}>
                      <section className="panel p-trend" data-reveal>
                        <div className="panel-head">
                          <div>
                            <PanelTitle text="A timeline of your AI usage" accent="AI usage" />
                            <p className="panel-sub">
                              Daily{" "}
                              {metric === "tokens"
                                ? "input + output tokens"
                                : "API-equivalent value (USD)"}{" "}
                              {isAll && "stacked by harness "}· dates in {data.timezone}
                            </p>
                          </div>
                          <div className="panel-tools">
                            <label className="select-pill">
                              <span className="sr-only">Date range</span>
                              <select
                                value={range}
                                onChange={(e) =>
                                  setRange(e.target.value as Range)
                                }
                              >
                                <option>All time</option>
                                <option>Last 30 days</option>
                                <option>Last 7 days</option>
                              </select>
                              <ChevronDown size={12} />
                            </label>
                            <div className="segmented" role="group" aria-label="Measure">
                              <button
                                className={
                                  metric === "tokens" ? "selected" : ""
                                }
                                aria-pressed={metric === "tokens"}
                                onClick={() => setMetric("tokens")}
                              >
                                Tokens
                              </button>
                              <button
                                className={
                                  metric === "cost" ? "selected" : ""
                                }
                                aria-pressed={metric === "cost"}
                                disabled={!availability.cost}
                                title={!availability.cost ? "Pricing is unavailable for these records" : undefined}
                                onClick={() => setMetric("cost")}
                              >
                                Value
                              </button>
                            </div>
                          </div>
                        </div>
                        <p className="figure inline">
                          <strong>
                            <CountUp value={metric === "tokens"
                              ? compact(
                                  filtered.reduce(
                                    (s, d) => s + d.totalTokens,
                                    0,
                                  ),
                                )
                              : money(
                                  filtered.reduce(
                                    (s, d) => s + d.costUsd,
                                    0,
                                  ),
                                )} />
                          </strong>
                          <span>{range.toLowerCase()}</span>
                        </p>
                        {isAll && (
                          <ul className="legend-inline trend-legend">
                            {shares.map(({ provider: p }) => (
                              <li key={p}><span className="swatch" style={{ background: HARNESS_COLORS[p] }} />{providerName(p)}</li>
                            ))}
                          </ul>
                        )}
                        <div className="chart">
                          {chart.length === 0 && <div className="chart-empty">No recorded usage rows in this date range.</div>}
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={chart}
                              margin={{
                                left: -12,
                                right: 8,
                                top: 8,
                                bottom: 0,
                              }}
                            >
                              <CartesianGrid
                                stroke={GRID}
                                vertical={false}
                              />
                              <XAxis
                                dataKey="date"
                                tickFormatter={dateLabel}
                                tick={axisTick}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={30}
                                dy={8}
                              />
                              <YAxis
                                tick={axisTick}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={
                                  metric === "tokens"
                                    ? compact
                                    : (v) => `$${compact(v)}`
                                }
                              />
                              {isAll ? (
                                <Tooltip content={<HarnessTooltip metric={metric} />} cursor={{ stroke: "#121212", strokeWidth: 1 }} />
                              ) : <Tooltip
                                contentStyle={tooltipStyle}
                                cursor={{ stroke: "#121212", strokeWidth: 1 }}
                                labelFormatter={(label) =>
                                  new Date(
                                    String(label) + "T12:00:00Z",
                                  ).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                    timeZone: "UTC",
                                  })
                                }
                                formatter={(value) => [
                                  metric === "tokens"
                                    ? `${number(Number(value))} tokens`
                                    : money(Number(value)),
                                  metric === "tokens"
                                    ? "Usage"
                                    : "API value",
                                ]}
                              />}
                              {isAll ? shares.map(({ provider: p }) => (
                                <Area
                                  key={p}
                                  isAnimationActive={false}
                                  type="linear"
                                  dataKey={`${p}_${metric}`}
                                  name={providerName(p)}
                                  stackId="harnesses"
                                  stroke="#ffffff"
                                  strokeWidth={1.5}
                                  fill={HARNESS_COLORS[p]}
                                  fillOpacity={1}
                                  activeDot={false}
                                />
                              )) : <Area
                                isAnimationActive={false}
                                type="linear"
                                dot={
                                  chart.length === 1
                                    ? { r: 4, fill: accent }
                                    : false
                                }
                                dataKey={metric}
                                stroke={accent}
                                strokeWidth={2}
                                fill={accent}
                                fillOpacity={0.08}
                                activeDot={{
                                  r: 5,
                                  fill: accent,
                                  stroke: "#ffffff",
                                  strokeWidth: 2,
                                }}
                              />}
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </section>
                      {isAll && (
                        <section className="panel p-harness" id="harnesses" data-reveal>
                          <div className="panel-head">
                            <div>
                              <PanelTitle text="Usage by harness" accent="harness" />
                              <p className="panel-sub">Each harness’s share of your recorded tokens</p>
                            </div>
                            <span className="panel-meta">{compact(overview.tokens)} reported tokens</span>
                          </div>
                          {overview.tokens > 0 && (
                            <div
                              className="model-stack"
                              role="img"
                              aria-label={shares.map((s) => `${providerName(s.provider)}: ${number(s.tokens)} tokens`).join(", ")}
                              data-active={harnessOn ? "" : undefined}
                              onPointerMove={(e) => {
                                const i = nearestSegment(e.currentTarget, e.clientX);
                                const s = shares[i];
                                if (!s || s.provider === harnessOn) return;
                                setHarnessOn(s.provider);
                                tip.show(e.currentTarget.children[i], (
                                  <>
                                    <div className="tip-title"><span className="swatch" style={{ background: HARNESS_COLORS[s.provider] }} />{providerName(s.provider)}</div>
                                    <div className="tip-row"><strong>{shareText(s.tokens, overview.tokens)}</strong> of all tokens</div>
                                    <div className="tip-row">{number(s.tokens)} tokens</div>
                                  </>
                                ));
                              }}
                              onPointerLeave={(e) => { setHarnessOn(null); tip.leave(e); }}
                            >
                              {shares.map((s) => (
                                <div
                                  key={s.provider}
                                  data-on={harnessOn === s.provider ? "" : undefined}
                                  style={{ width: `${(s.tokens / overview.tokens) * 100}%`, background: HARNESS_COLORS[s.provider] }}
                                />
                              ))}
                            </div>
                          )}
                          <div className="table-scroll">
                            <table className="ledger">
                              <thead>
                                <tr><th>Harness</th><th>Tokens</th><th>Share</th><th>Sessions</th><th>Human requests</th><th>API value</th></tr>
                              </thead>
                              <tbody>
                                {(harnesses ?? []).map(({ provider: p, snapshot, error: failed }) => {
                                  const recorded = snapshot && hasHistory(snapshot);
                                  const cell = (key: keyof MetricAvailability, amount: number, format = compact) =>
                                    recorded && metricAvailable(snapshot, key) ? format(amount) : "—";
                                  const tokens = recorded && metricAvailable(snapshot, "tokens") ? snapshot.totals.totalTokens : null;
                                  return (
                                    <tr key={p} data-on={harnessOn === p ? "" : undefined}
                                      onPointerEnter={() => setHarnessOn(p)} onPointerLeave={() => setHarnessOn(null)}>
                                      <td>
                                        <Link className="row-link" href={harnessHref(p)}>
                                          <span className="swatch" style={{ background: HARNESS_COLORS[p] }} />
                                          {providerName(p)} <ArrowUpRight size={12} />
                                        </Link>
                                        <small>
                                          {failed || (!recorded
                                            ? "No recorded history"
                                            : `Collected ${new Date(snapshot.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: snapshot.timezone })}`)}
                                        </small>
                                      </td>
                                      <td title={tokens === null ? "Tokens unavailable" : number(tokens)}>{tokens === null ? "—" : compact(tokens)}</td>
                                      <td>{tokens === null || !overview.tokens ? "—" : shareText(tokens, overview.tokens)}</td>
                                      <td>{snapshot ? cell("sessions", snapshot.totals.sessions, number) : "—"}</td>
                                      <td>{snapshot ? cell("humanRequests", snapshot.totals.humanRequests, number) : "—"}</td>
                                      <td>
                                        {snapshot ? cell("cost", snapshot.totals.costUsd, money) : "—"}
                                        {recorded && snapshot.totals.unpricedTokens > 0 && <small>+ unpriced tokens</small>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="table-note">
                            — means this metric or history is unavailable. Totals include only reported metrics.{" "}
                            <button className="text-link" onClick={() => setInfo(true)}>
                              About these totals <ArrowUpRight size={12} />
                            </button>
                          </p>
                        </section>
                      )}
                      <section className="panel p-mix" id="models" data-reveal>
                        <div className="panel-head">
                          <div>
                            <PanelTitle text="Your model mix" accent="mix" />
                            <p className="panel-sub">Share of every recorded token{isAll && ", across harnesses"}</p>
                          </div>
                          <span className="panel-meta">
                            {compact(totals.totalTokens)} tokens
                          </span>
                        </div>
                        <div
                          className="model-stack"
                          data-active={mixOn ? "" : undefined}
                          // The whole bar is the hover target: the nearest segment wins, so
                          // thin slivers are still easy to reach.
                          onPointerMove={(e) => {
                            const best = nearestSegment(e.currentTarget, e.clientX);
                            const s = segments[best];
                            if (!s || s.key === mixOn) return;
                            setMixOn(s.key);
                            tip.show(e.currentTarget.children[best], (
                              <>
                                <div className="tip-title"><span className="swatch" style={{ background: s.color }} />{s.label}</div>
                                <div className="tip-row"><strong>{shareText(s.tokens, totals.totalTokens)}</strong> of all tokens</div>
                                <div className="tip-row">{number(s.tokens)} tokens</div>
                              </>
                            ));
                          }}
                          onPointerLeave={(e) => { setMixOn(null); tip.leave(e); }}
                          role="img"
                          aria-label={models
                            .map(
                              (m) =>
                                `${m.model}: ${number(m.totalTokens)} tokens`,
                            )
                            .join(", ")}
                        >
                          {segments.map((s) => (
                            <div
                              key={s.key}
                              data-on={mixOn === s.key ? "" : undefined}
                              style={{
                                width: `${totals.totalTokens ? (s.tokens / totals.totalTokens) * 100 : 0}%`,
                                background: s.color,
                              }}
                            />
                          ))}
                        </div>
                        <ul className="legend-list" data-active={mixOn ? "" : undefined}>
                          {segments.map((s) => (
                            <li
                              key={s.key}
                              data-on={mixOn === s.key ? "" : undefined}
                              onPointerEnter={() => setMixOn(s.key)}
                              onPointerLeave={() => setMixOn(null)}
                            >
                              <span
                                className="swatch"
                                style={{ background: s.color }}
                              />
                              <span className="legend-name">{s.label}</span>
                              <strong>
                                {shareText(s.tokens, totals.totalTokens)}
                              </strong>
                              <small>{compact(s.tokens)}</small>
                            </li>
                          ))}
                          {!models.length && (
                            <li className="legend-empty">
                              {isCursor
                                ? "Add a fresh Cursor usage export to see your model mix."
                                : isAll
                                  ? "No tokens recorded. Collect or sync usage from a harness to see your model mix."
                                  : `No tokens recorded. Start a ${product} session to see your model mix.`}
                            </li>
                          )}
                        </ul>
                      </section>
                      <section className="panel p-activity" id="activity" data-reveal>
                        <div className="panel-head">
                          <div>
                            <PanelTitle text="A year of making things" accent="making things" />
                            <p className="panel-sub">
                              One square per day, shaded by {byRequests ? "requests" : "tokens"}
                            </p>
                          </div>
                          <div className="panel-tools">
                            <p className="figure inline">
                              <strong><CountUp value={String(activeDays)} /></strong>
                              <span>active days</span>
                            </p>
                            <label className="select-pill">
                              <span className="sr-only">Activity year</span>
                              <select
                                aria-label="Activity year"
                                value={
                                  calendarYear ||
                                  Number(
                                    dayInZone(
                                      data.generatedAt,
                                      data.timezone,
                                    ).slice(0, 4),
                                  )
                                }
                                onChange={(e) =>
                                  setYear(Number(e.target.value))
                                }
                              >
                                {Array.from(
                                  new Set([
                                    ...data.daily.map((d) =>
                                      Number(d.date.slice(0, 4)),
                                    ),
                                    new Date(
                                      data.generatedAt,
                                    ).getUTCFullYear(),
                                  ]),
                                )
                                  .sort((a, b) => b - a)
                                  .map((y) => (
                                    <option key={y}>{y}</option>
                                  ))}
                              </select>
                              <ChevronDown size={12} />
                            </label>
                          </div>
                        </div>
                        <div className="heatmap-scroll" ref={heatmapRef}>
                          <div className="heatmap-months">
                            {[
                              "Jan",
                              "Feb",
                              "Mar",
                              "Apr",
                              "May",
                              "Jun",
                              "Jul",
                              "Aug",
                              "Sep",
                              "Oct",
                              "Nov",
                              "Dec",
                            ].map((m) => (
                              <span key={m}>{m}</span>
                            ))}
                          </div>
                          <div className="heatmap-layout">
                            <div className="day-labels">
                              <span>Mon</span>
                              <span>Wed</span>
                              <span>Fri</span>
                            </div>
                            <div
                              className="heatmap"
                              // One listener for every day: pointer or keyboard focus shows its card.
                              onPointerOver={(e) => showDay(e.target as Element)}
                              onFocus={(e) => showDay(e.target as Element)}
                              onPointerLeave={tip.leave}
                              onBlur={tip.hide}
                              role="group"
                              aria-label={
                                byRequests
                                  ? "Daily activity calendar"
                                  : "Daily token contribution calendar"
                              }
                            >
                              {activity.map((d, i) => {
                                const value = byRequests ? d.requests : d.tokens,
                                  level =
                                    value === 0 && !(byRequests && d.active)
                                      ? 0
                                      : Math.max(
                                          1,
                                          Math.min(
                                            4,
                                            Math.ceil((value / maxDay) * 4),
                                          ),
                                        );
                                return (
                                  <button
                                    key={d.date}
                                    className={`heat-cell level-${level} ${d.future ? "future" : ""}`}
                                    style={{ "--c": Math.floor(i / 7) } as React.CSSProperties}
                                    data-i={i}
                                    aria-label={`${d.date}: ${number(d.tokens)} tokens`}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        </div>
                        <div className="heatmap-footer">
                          Less{" "}
                          {[0, 1, 2, 3, 4].map((n) => (
                            <i key={n} className={`heat-cell level-${n}`} />
                          ))}{" "}
                          More
                        </div>
                      </section>
                      <section className="panel p-hood" data-reveal>
                        <div className="panel-head">
                          <div>
                            <PanelTitle text="Under the hood" accent="hood" />
                            <p className="panel-sub">Where your tokens go</p>
                          </div>
                        </div>
                        <div className="hood">
                          <div
                            className="donut-wrap"
                            // The ring is the hover target: the pointer's angle picks the slice.
                            // Slices start at 12 o'clock and run clockwise; minAngle mirrors
                            // the Pie below so thin slices line up.
                            onPointerMove={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
                              const radius = Math.min(r.width, r.height) / 2;
                              if (Math.hypot(dx, dy) < radius * 0.56) return setHoodOn(null);
                              const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
                              const sum = inputBreakdown.reduce((t, d) => t + d.value, 0);
                              const spread = 360 - inputBreakdown.length * DONUT_MIN_ANGLE;
                              let end = 0;
                              const i = inputBreakdown.findIndex((d) => (end += DONUT_MIN_ANGLE + (d.value / sum) * spread) > angle);
                              setHoodOn(i < 0 ? inputBreakdown.length - 1 : i);
                            }}
                            onPointerLeave={() => setHoodOn(null)}
                          >
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  isAnimationActive={false}
                                  data={inputBreakdown}
                                  dataKey="value"
                                  nameKey="name"
                                  minAngle={DONUT_MIN_ANGLE}
                                  startAngle={90}
                                  endAngle={-270}
                                  innerRadius="64%"
                                  outerRadius="96%"
                                  stroke="#ffffff"
                                  strokeWidth={2}
                                >
                                  {inputBreakdown.map((d, i) => (
                                    <Cell key={d.name} fill={d.color} fillOpacity={hoodOn === null || hoodOn === i ? 1 : 0.25} />
                                  ))}
                                </Pie>
                              </PieChart>
                            </ResponsiveContainer>
                            {/* The centre reads out the hovered slice, or the total. The total stays
                                mounted so its count-up doesn't replay after every hover. */}
                            <div className="donut-label" aria-live="polite">
                              <span>{hovered ? hovered.name : "Total"}</span>
                              <strong>
                                {hovered && compact(hovered.value)}
                                <span hidden={Boolean(hovered)}><CountUp value={compact(totals.totalTokens)} /></span>
                              </strong>
                              {hovered && <small>{shareText(hovered.value, totals.totalTokens)}</small>}
                            </div>
                          </div>
                          <ul className="legend-list" data-active={hovered ? "" : undefined}>
                            {inputBreakdown.map((d, i) => (
                              <li
                                key={d.name}
                                data-on={hoodOn === i ? "" : undefined}
                                onPointerEnter={() => setHoodOn(i)}
                                onPointerLeave={() => setHoodOn(null)}
                              >
                                <span
                                  className="swatch"
                                  style={{ background: d.color }}
                                />
                                <span className="legend-name">{d.name}</span>
                                <strong>
                                  {shareText(d.value, totals.totalTokens)}
                                </strong>
                                <small>{compact(d.value)}</small>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </section>
                      <section className="panel p-hours" data-reveal>
                        <div className="panel-head">
                          <div>
                            <PanelTitle text="Your creative hours" accent="creative" />
                            <p className="panel-sub">Tokens by hour of day · {data.timezone}</p>
                          </div>
                        </div>
                        <div className="hour-chart">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={data.hours}
                              margin={{
                                left: -12,
                                right: 4,
                                top: 8,
                                bottom: 0,
                              }}
                            >
                              <CartesianGrid
                                stroke={GRID}
                                vertical={false}
                              />
                              <XAxis
                                dataKey="hour"
                                interval={3}
                                tickFormatter={(v) =>
                                  `${String(v).padStart(2, "0")}:00`
                                }
                                tick={axisTick}
                                tickLine={false}
                                axisLine={false}
                              />
                              <YAxis
                                tickFormatter={compact}
                                tick={axisTick}
                                tickLine={false}
                                axisLine={false}
                              />
                              <Tooltip
                                contentStyle={tooltipStyle}
                                cursor={{ fill: "#f2f2f2" }}
                                labelFormatter={(v) =>
                                  `${String(v).padStart(2, "0")}:00`
                                }
                                formatter={(v) => [
                                  `${number(Number(v))} tokens`,
                                  "Usage",
                                ]}
                              />
                              <Bar
                                isAnimationActive={false}
                                dataKey="tokens"
                                fill={accent}
                                radius={[4, 4, 0, 0]}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </section>
                      <section className="panel p-power spotlight" data-reveal>
                        <p className="eyebrow on-dark">The power session</p>
                        <h2 className="panel-title">Your biggest 24 hours.</h2>
                        {/* The figure shrinks to fit the panel on one line, so a value never breaks mid-number. */}
                        <div className="spotlight-value" style={{ "--chars": Math.max(powerValue.length, 4) } as React.CSSProperties}>
                          <CountUp value={powerValue} />
                        </div>
                        <span className="spotlight-unit">API-equivalent value</span>
                        <p>
                          {!availability.cost
                            ? "Requires priced token records."
                            : power
                            ? `${compact(power.window.tokens)} tokens in ${providerName(power.provider)}’s highest-value rolling 24-hour window.`
                            : data.mostExpensive24h
                            ? `${compact(data.mostExpensive24h.tokens)} tokens in your highest-value rolling 24-hour window.`
                            : "Your most active window will appear as usage is recorded."}
                        </p>
                        <div className="spotlight-bottom">
                          {data.mostExpensive24h
                            ? `${new Date(data.mostExpensive24h.start).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: data.timezone })} · ${new Date(data.mostExpensive24h.start).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: data.timezone })} → +24 hours`
                            : "Waiting for history"}
                        </div>
                      </section>
                      <section className="panel p-ledger" data-reveal>
                        <div className="panel-head">
                          <div>
                            <PanelTitle text="The model ledger" accent="ledger" />
                            <p className="panel-sub">Input, output and estimated value per model · USD at standard API rates</p>
                          </div>
                        </div>
                        <div className="table-scroll">
                          <table className="ledger">
                            <thead>
                              <tr>
                                <th>Model</th>
                                <th>Input</th>
                                <th>Cached input¹</th>
                                {(isClaude || isCursor || isAll) && (
                                  <th>Cache writes¹</th>
                                )}
                                <th>Output</th>
                                <th>API value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {models.map((m, i) => (
                                <tr key={m.model}>
                                  <td>
                                    <span
                                      className="swatch"
                                      style={{
                                        background: colorFor(i),
                                      }}
                                    />
                                    {modelLabel(m.model)}
                                  </td>
                                  <td title={number(m.inputTokens)}>
                                    {compact(m.inputTokens)}
                                  </td>
                                  <td title={number(m.cachedInputTokens)}>
                                    {compact(m.cachedInputTokens)}
                                  </td>
                                  {(isClaude || isCursor || isAll) && (
                                    <td title={number(m.cacheWriteTokens)}>
                                      {compact(m.cacheWriteTokens)}
                                    </td>
                                  )}
                                  <td title={number(m.outputTokens)}>
                                    {compact(m.outputTokens)}
                                  </td>
                                  <td>
                                    {!availability.cost ? (
                                      "Unavailable"
                                    ) : !m.priced ? (
                                      <span title="Some or all tokens have no verified API price">
                                        {m.costUsd > 0
                                          ? `${money(m.costUsd)} + unpriced`
                                          : "Unpriced"}
                                      </span>
                                    ) : (
                                      money(m.costUsd)
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="table-note">
                          ¹ Cached tokens are part of input, not additional
                          tokens. Reasoning is included in output.{" "}
                          <button className="text-link" onClick={() => setInfo(true)}>
                            Pricing & methodology <ArrowUpRight size={12} />
                          </button>
                        </p>
                      </section>
                    </div>
                  ) : (
                    <section className="notice-block import-state" id="models">
                      <h2 className="display-s">
                        {isAll
                          ? "No harness reports tokens yet."
                          : isAntigravity
                          ? "No Antigravity conversations found."
                          : "Token graphs need a usage export."}
                      </h2>
                      <p>
                        {isAll
                          ? "Collect or sync usage from Codex, Claude Code, Cursor or Antigravity to see your combined graphs here. This view checks for changes every 15 seconds."
                          : isAntigravity
                          ? "Use Antigravity once, or set ANTIGRAVITY_HOME to the folder that contains antigravity/ and antigravity-cli/ (default ~/.gemini). This view re-reads those local databases every 15 seconds."
                          : "Set CURSOR_AUTO_SYNC=true to fetch your usage events from your Cursor account automatically, or export them from your Cursor dashboard and set CURSOR_USAGE_CSV / put exports in data/cursor-imports. This view checks for changes every 15 seconds. Local context-window counters are not treated as billed token records."}
                      </p>
                      {isCursor && (
                        <a
                          className="pill pill-outline"
                          href="https://cursor.com/dashboard/usage"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Cursor usage <ExternalLink size={14} />
                        </a>
                      )}
                    </section>
                  )}
                </>
              )
            )}
          </>
        )}
      </main>
      <HoverTip tip={tip.tip} />
      <footer className="site-footer">
        <span className="wordmark small">{brand}<span>vibe check</span></span>
        <button className="text-link" onClick={() => setInfo(true)}>
          Data & privacy <ArrowUpRight size={12} />
        </button>
        <a
          className="text-link"
          href="https://www.linkedin.com/in/darrellchee"
          target="_blank"
          rel="noopener noreferrer"
        >
          Buy me a coffee <ArrowUpRight size={12} />
        </a>
      </footer>
      {info && (
        <div className="modal-backdrop" onClick={() => setInfo(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="method-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="modal-close round"
              aria-label="Close methodology"
              onClick={() => setInfo(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Behind the numbers</p>
            <h2 id="method-title" className="display-s">A clear view of your usage.</h2>
            <p>
              This dashboard measures{" "}
              <strong>retained {product} history</strong>, not a verified
              account lifetime. Deleted sessions, other devices, and cloud-only
              sessions may be missing. Your subscription bill is separate.
            </p>
            {isAll && (
              <>
                <h3>How harnesses add up</h3>
                <p>
                  Totals add the retained usage each harness reports, and only
                  the metrics it reports: a harness that cannot report a metric
                  is left out of that total, not counted as zero. Sessions and
                  requests follow each harness’s own definitions. Days use each
                  source’s recorded timezone, and overlapping imports across
                  harnesses are not deduplicated. Hours of day include harnesses
                  recorded in {data?.timezone ?? "your timezone"}. The power
                  session is the biggest single-harness 24-hour window, since
                  windows cannot be joined across harnesses from totals alone.
                </p>
              </>
            )}
            <h3>What counts?</h3>
            <p>
              {isAll
                ? "Each harness counts input its own way; open its page for the details."
                : isCursor
                ? "Cursor token totals come from your usage events (automatic account sync or imported exports). Input includes ordinary input, cache reads and cache writes. Exported usage events are model calls, not human prompts. Sessions and human requests come from local Cursor history when it is available, and cover only what this device retained."
                : isAntigravity
                  ? "Antigravity input is uncached input plus cache reads; cache writes are not recorded. Output includes thinking tokens. Each recorded model call is one request, and human requests are user-input steps."
                : isClaude
                  ? "Claude input is normalized to include fresh input, cache reads and cache writes. Five-minute and one-hour writes are priced separately when recorded."
                  : "Input includes cached input."}{" "}
              Output includes reasoning. Each response is counted once. Human
              request counts are best-effort user turns; agent prompts are
              excluded where identifiable. Sessions are distinct recorded
              threads, including agent threads.
            </p>
            <h3>How value is estimated</h3>
            <p>
              Tokens are multiplied by published, current API prices with cache
              discounts and known context/tier adjustments. This is an estimate,
              not historical billing or actual subscription spend. Models
              without verified prices stay unpriced. Highest-value session means
              a rolling 24-hour window across recorded activity.
            </p>
            <h3>Live, and private by design</h3>
            <p>
              The view refreshes every 15 seconds. Cloud mode shows the latest
              collector upload; new usage requires the collector to run on the
              machine holding your history. Uploads contain usage aggregates
              only. This version uses one collector per product; Codex, Claude
              Code, Cursor and Antigravity are stored separately. Cursor account usage
              changes require a refreshed export.
            </p>
            {data && (
              <>
                <dl className="method-meta">
                  <dt>Last collected</dt>
                  <dd>{new Date(data.generatedAt).toLocaleString()}</dd>
                  <dt>History files scanned</dt>
                  <dd>{data.coverage.filesScanned}</dd>
                  <dt>Pricing checked</dt>
                  <dd>{data.pricing.checkedAt}</dd>
                </dl>
                {data.coverage.warnings.map((w, i) => (
                  <p className="method-warning" key={i}>
                    <Info size={14} />
                    {w}
                  </p>
                ))}
                <div className="source-links">
                  {data.pricing.sources.map((s, i) => (
                    <a href={s} key={i} target="_blank" rel="noreferrer">
                      {s.includes("/models/")
                        ? modelLabel(s.split("/").at(-1) || "")
                        : "API rate card"}{" "}
                      <ExternalLink size={12} />
                    </a>
                  ))}
                </div>
              </>
            )}
            <button className="pill pill-filled" onClick={() => setInfo(false)}>
              <Check size={16} /> Got it
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  index,
  label,
  value,
  detail,
  foot,
}: {
  index: number;
  label: string;
  value: string;
  detail: React.ReactNode;
  foot: string;
}) {
  return (
    <article className="stat">
      <div className="stat-label">
        <span className="stat-index">{String(index).padStart(2, "0")}</span>
        {label}
      </div>
      <div
        className={`stat-value ${value === "Unavailable" ? "unavailable" : ""}`}
      >
        <CountUp value={value} />
      </div>
      <div className="stat-detail">{detail}</div>
      <div className="stat-foot">{foot}</div>
    </article>
  );
}
