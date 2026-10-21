"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  Database,
  ExternalLink,
  Fingerprint,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  Terminal,
  X,
  Zap,
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
import ProviderNavigation from "./provider-navigation";
import { useRouter } from "next/navigation";
import type { UsageProvider, UsageSnapshot } from "@/lib/types";
const COLORS = [
  "#a3e635",
  "#a78bfa",
  "#38bdf8",
  "#fb923c",
  "#f472b6",
  "#2dd4bf",
  "#facc15",
  "#818cf8",
  "#fb7185",
  "#c4b5fd",
  "#67e8f9",
  "#e5c07b",
];
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
const modelLabel = (s: string) => {
  const claude = s.match(
    /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/,
  );
  if (claude)
    return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? "." + claude[3] : ""}`;
  return s
    .replace(/^gpt-/, "GPT-")
    .replace(/-codex/g, " Codex")
    .replace(
      /-(sol|astra|luna|terra)/g,
      (_, x: string) => ` ${x[0].toUpperCase()}${x.slice(1)}`,
    );
};
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
const recordedDate = (timestamp: string, timezone: string) =>
  new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  });
const modelColor = (i: number) =>
  COLORS[i] || `hsl(${(i * 137.508) % 360} 65% 66%)`;
const tooltipStyle = {
  background: "#202322",
  border: "1px solid #3a3e37",
  borderRadius: 10,
  color: "#f1f1ed",
  fontSize: 12,
};
const ALL_AVAILABLE = {
  tokens: true,
  cost: true,
  sessions: true,
  humanRequests: true,
  assistantRequests: true,
  cacheBreakdown: true,
};
type Range = "All time" | "Last 30 days" | "Last 7 days";
export default function Dashboard({
  provider = "codex",
}: {
  provider?: UsageProvider;
}) {
  const isClaude = provider === "claude",
    isCursor = provider === "cursor",
    isAntigravity = provider === "antigravity",
    // Imported or retained history can end well before today, so ranges and
    // the calendar anchor to the last recorded event instead of the wall clock.
    anchorToLastEvent = isCursor || isAntigravity,
    product = isClaude
      ? "Claude Code"
      : isCursor
        ? "Cursor"
        : isAntigravity
          ? "Antigravity"
          : "Codex",
    brand = provider,
    accent = isClaude
      ? "#e8a67b"
      : isCursor
        ? "#8ac5f7"
        : isAntigravity
          ? "#aa8af7"
          : "#a3e635";
  const colorFor = (i: number) =>
    (isClaude || isCursor || isAntigravity) && i === 0
      ? accent
      : // Palette slot 1 is a near twin of the violet accent, so skip it.
        modelColor(isAntigravity ? i + 1 : i);

  const router = useRouter();
  const heatmapRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<UsageSnapshot | null>(null),
    [error, setError] = useState(""),
    [locked, setLocked] = useState(false),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [range, setRange] = useState<Range>("All time"),
    [tab, setTab] = useState("Overview"),
    [info, setInfo] = useState(false),
    [metricChoice, setMetric] = useState<"tokens" | "cost">("tokens"),
    [lastChecked, setLastChecked] = useState(""),
    [checkedAt, setCheckedAt] = useState(0),
    [year, setYear] = useState<number | null>(null);
  const availability = data?.availability ?? ALL_AVAILABLE;
  const metric =
    metricChoice === "cost" && !availability.cost ? "tokens" : metricChoice;
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/usage?provider=${provider}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        setLocked(true);
        // A brand-new deployment has no password yet: send its first visitor to setup.
        void fetch("/api/setup/status", { cache: "no-store" })
          .then((r) => r.json())
          .then((s) => {
            if (s?.cloud && s.storage === "ok" && !s.claimed) router.push("/setup");
          })
          .catch(() => {});
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load usage.");
      if ((body.provider || "codex") !== provider)
        throw new Error(
          "Received usage for a different product. Try refreshing.",
        );
      setData(body);
      setCheckedAt(Date.now());
      setLocked(false);
      setError("");
      setLastChecked(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }, [provider, router]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), 15_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [refresh]);
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
    if (el && window.innerWidth < 640) el.scrollLeft = el.scrollWidth;
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
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${brand}-atlas-${data.generatedAt.slice(0, 10)}.json`;
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
  // Tokens only exist for exported days, so divide by the sessions on those
  // same days rather than the whole retained history.
  const matchedTokens = (data?.daily || []).filter((d) => d.totalTokens > 0),
    matchedSessions = matchedTokens.reduce((sum, d) => sum + d.sessions, 0),
    matchedAverage = matchedSessions
      ? matchedTokens.reduce((sum, d) => sum + d.totalTokens, 0) /
        matchedSessions
      : 0;
  const chart = useMemo(() => {
    if (!data) return [];
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
        date: key,
        tokens: d?.totalTokens || 0,
        cost: d?.costUsd || 0,
      });
    }
    return result;
  }, [data, filtered, range, anchorToLastEvent]);
  const inputBreakdown = totals
    ? [
        {
          name: "Cached input",
          value: totals.cachedInputTokens,
          color: accent,
        },
        {
          name: "Cache writes",
          value: totals.cacheWriteTokens,
          color: "#fb923c",
        },
        {
          name: "Fresh input",
          value:
            totals.inputTokens -
            totals.cachedInputTokens -
            totals.cacheWriteTokens,
          color: isAntigravity ? "#2dd4bf" : "#a78bfa",
        },
        { name: "Output", value: totals.outputTokens, color: "#38bdf8" },
      ].filter((d) => d.value > 0)
    : [];
  return (
    <div className={`shell ${isClaude ? "claude" : isCursor ? "cursor" : isAntigravity ? "antigravity" : ""}`}>
      <aside className="sidebar">
        <Link
          className="brand"
          href={isClaude ? "/claude" : isCursor ? "/cursor" : isAntigravity ? "/antigravity" : "/"}
          aria-label={`${product} Atlas home`}
        >
          <span className="brand-icon">
            <Terminal size={22} />
          </span>
          <span>
            {brand}
            <span className="brand-light">atlas</span>
            <small>YOUR PERSONAL OBSERVATORY</small>
          </span>
        </Link>
        <div className="workspace">
          <div className="avatar">D</div>
          <div>
            Personal workspace
            <small>
              {isClaude ? "Claude Code" : isCursor ? "Cursor" : isAntigravity ? "Antigravity" : "Codex Pro"}{" "}
              <span>PERSONAL</span>
            </small>
          </div>
          <ChevronDown size={13} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            { name: "Overview", icon: Layers3 },
            { name: "Activity", icon: Activity },
            { name: "Models", icon: Sparkles },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={tab === name ? "active" : ""}
              onClick={() => {
                setTab(name);
                document
                  .getElementById(
                    name === "Activity"
                      ? "activity"
                      : name === "Models"
                        ? "models"
                        : "overview",
                  )
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Icon size={17} />
              {name}
              {tab === name && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <Fingerprint size={19} />
          </div>
          <strong>Your data. Your perspective.</strong>
          <p>Usage numbers only. Your conversations stay with you.</p>
          <button onClick={() => setInfo(true)}>
            How it works <ArrowUpRight size={13} />
          </button>
        </div>
        <button className="sidebar-bottom" onClick={() => setInfo(true)}>
          <Code2 size={17} />
          <span>
            Built for the curious<small>{product} Atlas v0.2</small>
          </span>
          <ArrowUpRight size={14} />
        </button>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <span className="slash">/</span>
            {tab}
          </div>
          <div className="topbar-right">
            <ProviderNavigation selected={provider} />
            <span className="plan-badge">
              <Zap size={12} />{" "}
              {isClaude ? "CLAUDE CODE" : isCursor ? "CURSOR" : isAntigravity ? "ANTIGRAVITY" : "PERSONAL PRO"}
            </span>
            <div className="avatar small">D</div>
          </div>
        </header>
        <main id="overview">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> THE BIG PICTURE
              </div>
              <h1>
                Your work, in perspective<span>.</span>
              </h1>
              <p>
                {`A little curiosity. A lot of tokens. Here’s your ${product} story.`}
              </p>
            </div>
            <div className="heading-actions">
              <Link
                className="button"
                href="/share"
                aria-label="Set up your GitHub profile card"
              >
                <Code2 size={14} /> GitHub profile
              </Link>
              <button
                className="icon-button"
                aria-label="Refresh usage"
                onClick={() => void refresh()}
                disabled={busy}
              >
                <RefreshCw size={16} className={busy ? "spin" : ""} />
              </button>
              <button className="button" onClick={download} disabled={!data}>
                <ArrowDownToLine size={14} /> Export data
              </button>
            </div>
          </div>
          {locked ? (
            <section className="panel login">
              <LockKeyhole size={28} />
              <h2>Your observatory is private.</h2>
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
                <button className="button primary" disabled={busy}>
                  Unlock <ArrowRight size={15} />
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
                  <button onClick={() => void refresh()}>Try again</button>
                </div>
              )}
              {!data && !error ? (
                <section className="loading">
                  <LoaderCircle className="spin" />
                  <h2>Reading your {product} history</h2>
                  <p>
                    Counting tokens. Your conversations stay on this machine.
                  </p>
                </section>
              ) : (
                data &&
                totals && (
                  <>
                    <div className="status-row">
                      <span className="live">
                        <span />{" "}
                        {data.source === "local"
                          ? isCursor && availability.tokens
                            ? "CURSOR USAGE"
                            : "LOCAL COLLECTOR"
                          : "CLOUD SYNC"}
                      </span>
                      <span className="status-text">
                        {data.coverage.firstEvent
                          ? `Recorded ${recordedDate(data.coverage.firstEvent, data.timezone)} – ${recordedDate(data.coverage.lastEvent || data.generatedAt, data.timezone)}`
                          : "No recorded history yet"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setInfo(true)}
                      >
                        About this data <Info size={12} />
                      </button>
                      <span className="updated">
                        {data.source === "cloud"
                          ? `Collected ${new Date(data.generatedAt).toLocaleString()}${checkedAt - Date.parse(data.generatedAt) > 90_000 ? " · awaiting sync" : ""}`
                          : `Checked ${lastChecked} · refreshes every 15s`}
                      </span>
                    </div>
                    {isCursor && (
                      <div className="coverage-notice">
                        <Info size={15} />
                        <span>
                          {availability.tokens
                            ? availability.sessions
                              ? "Cursor tokens, models and cost come from your usage events (automatic account sync or imported exports); sessions and activity come from local history. Source details lists the covered dates."
                              : "Cursor token graphs show imported usage exports. Add a fresh export, or enable CURSOR_AUTO_SYNC, to update account usage."
                            : "No token export is loaded. Local activity may be shown, but token and cost graphs need a Cursor Usage events CSV."}{" "}
                          <button
                            className="text-button"
                            onClick={() => setInfo(true)}
                          >
                            Source details <ArrowUpRight size={11} />
                          </button>
                        </span>
                      </div>
                    )}
                    <section
                      className="stats-grid"
                      aria-label="Statistics across recorded history"
                    >
                      <Stat
                        label="TOTAL TOKENS"
                        value={
                          availability.tokens
                            ? compact(totals.totalTokens)
                            : "Unavailable"
                        }
                        icon={<Layers3 size={16} />}
                        detail={
                          availability.tokens ? (
                            <>
                              <span className="mini-dot lime" />
                              {compact(totals.inputTokens)} input{" "}
                              <span className="mini-dot blue" />
                              {compact(totals.outputTokens)} output
                            </>
                          ) : (
                            "Not reported by local activity records"
                          )
                        }
                        foot={
                          isCursor
                            ? "From your Cursor usage events"
                            : "Across all recorded history"
                        }
                      />
                      <Stat
                        label="API-EQUIVALENT VALUE"
                        value={
                          availability.cost
                            ? money(totals.costUsd)
                            : "Unavailable"
                        }
                        icon={<Zap size={16} />}
                        detail={
                          <>
                            <span className="estimate">ESTIMATE</span> USD ·
                            current API rates
                          </>
                        }
                        foot={
                          !availability.cost
                            ? "Requires priced token records"
                            : totals.unpricedTokens > 0
                              ? `${compact(totals.unpricedTokens)} tokens have no cost estimate`
                              : "Cache-aware · not your subscription bill"
                        }
                      />
                      <Stat
                        label="RECORDED SESSIONS"
                        value={
                          availability.sessions
                            ? number(totals.sessions)
                            : "Unavailable"
                        }
                        icon={<Terminal size={16} />}
                        detail={
                          availability.humanRequests ? (
                            <>
                              <span className="stat-accent">
                                {number(totals.humanRequests)}
                              </span>{" "}
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
                        label="AVG. TOKENS / SESSION"
                        value={
                          availability.tokens && availability.sessions
                            ? byRequests
                              ? matchedSessions
                                ? compact(matchedAverage)
                                : "Unavailable"
                              : compact(totals.averageTokensPerSession)
                            : "Unavailable"
                        }
                        icon={<BarChart3 size={16} />}
                        detail={
                          !availability.tokens ? "Model usage unavailable" : <>
                            <span className="stat-accent">{models.length}</span>{" "}
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
                      <>
                        <section className="panel model-panel" id="models">
                          <div className="panel-heading">
                            <div>
                              <h2>
                                Your model mix{" "}
                                <span className="subtle-tag">
                                  ALL RECORDED HISTORY
                                </span>
                              </h2>
                              <p>
                                One bar. Every token. A different color for
                                every model.
                              </p>
                            </div>
                            <span className="mono subdued">
                              {number(totals.totalTokens)} tokens
                            </span>
                          </div>
                          <div
                            className="model-stack"
                            role="img"
                            aria-label={models
                              .map(
                                (m) =>
                                  `${m.model}: ${number(m.totalTokens)} tokens`,
                              )
                              .join(", ")}
                          >
                            {models.map((m, i) => (
                              <div
                                key={m.model}
                                style={{
                                  width: `${totals.totalTokens ? (m.totalTokens / totals.totalTokens) * 100 : 0}%`,
                                  background: colorFor(i),
                                }}
                                title={`${modelLabel(m.model)} · ${compact(m.totalTokens)}`}
                              />
                            ))}
                          </div>
                          <div className="model-legend">
                            {models.map((m, i) => (
                              <span key={m.model}>
                                <span
                                  className="legend-dot"
                                  style={{ background: colorFor(i) }}
                                />
                                {modelLabel(m.model)}
                                <strong>
                                  {shareText(m.totalTokens, totals.totalTokens)}
                                </strong>
                                <small>{compact(m.totalTokens)}</small>
                              </span>
                            ))}
                            {!models.length && (
                              <span>
                                {isCursor ? "Add a fresh Cursor usage export to see your model mix." : `No tokens recorded. Start a ${product} session to see your model mix.`}
                              </span>
                            )}
                          </div>
                        </section>
                        <div className="two-column">
                          <section className="panel trend-panel">
                            <div className="panel-heading">
                              <div>
                                <h2>Small prompts. Big momentum.</h2>
                                <p>
                                  Your daily{" "}
                                  {metric === "tokens"
                                    ? "token usage"
                                    : "API-equivalent value"}{" "}
                                  over time.
                                </p>
                              </div>
                              <label className="select-wrap">
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
                            </div>
                            <div className="trend-summary">
                              <strong>
                                {metric === "tokens"
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
                                    )}
                              </strong>
                              <span>{range.toLowerCase()}</span>
                              <div className="segmented">
                                <button
                                  className={
                                    metric === "tokens" ? "selected" : ""
                                  }
                                  onClick={() => setMetric("tokens")}
                                >
                                  Tokens
                                </button>
                                <button
                                  className={
                                    metric === "cost" ? "selected" : ""
                                  }
                                  disabled={!availability.cost}
                                  title={!availability.cost ? "Pricing is unavailable for these records" : undefined}
                                  onClick={() => setMetric("cost")}
                                >
                                  Value
                                </button>
                              </div>
                            </div>
                            <div className="chart">
                              {chart.length === 0 && <div className="chart-empty">No recorded usage rows in this date range.</div>}
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                  data={chart}
                                  margin={{
                                    left: -18,
                                    right: 12,
                                    top: 15,
                                    bottom: 0,
                                  }}
                                >
                                  <defs>
                                    <linearGradient
                                      id="tokenGradient"
                                      x1="0"
                                      y1="0"
                                      x2="0"
                                      y2="1"
                                    >
                                      <stop
                                        offset="0%"
                                        stopColor={accent}
                                        stopOpacity={0.27}
                                      />
                                      <stop
                                        offset="95%"
                                        stopColor={accent}
                                        stopOpacity={0}
                                      />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid
                                    stroke="#30342d"
                                    strokeDasharray="3 5"
                                    vertical={false}
                                  />
                                  <XAxis
                                    dataKey="date"
                                    tickFormatter={dateLabel}
                                    stroke="#777e71"
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={10}
                                    minTickGap={30}
                                    dy={10}
                                  />
                                  <YAxis
                                    stroke="#777e71"
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={
                                      metric === "tokens"
                                        ? compact
                                        : (v) => `$${compact(v)}`
                                    }
                                    fontSize={10}
                                  />
                                  <Tooltip
                                    contentStyle={tooltipStyle}
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
                                  />
                                  <Area
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
                                    fill="url(#tokenGradient)"
                                    activeDot={{
                                      r: 4,
                                      fill: "#d5f99b",
                                      stroke: "#171b14",
                                      strokeWidth: 3,
                                    }}
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="chart-caption">
                              <span
                                className="legend-dot"
                                style={{ background: accent }}
                              />{" "}
                              {metric === "tokens"
                                ? "Input + output tokens"
                                : "Estimated API value (USD)"}
                              <span>Dates in {data.timezone}</span>
                            </div>
                          </section>
                          <section className="panel token-panel">
                            <div className="panel-heading">
                              <div>
                                <h2>Under the hood</h2>
                                <p>Where your tokens go.</p>
                              </div>
                              <Info size={15} className="subdued" />
                            </div>
                            <div className="donut-wrap">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    isAnimationActive={false}
                                    data={inputBreakdown}
                                    dataKey="value"
                                    nameKey="name"
                                    minAngle={1}
                                    innerRadius="64%"
                                    outerRadius="84%"
                                    paddingAngle={3}
                                    stroke="none"
                                    cornerRadius={4}
                                  >
                                    {inputBreakdown.map((d) => (
                                      <Cell key={d.name} fill={d.color} />
                                    ))}
                                  </Pie>
                                  <Tooltip
                                    contentStyle={tooltipStyle}
                                    formatter={(v) =>
                                      `${number(Number(v))} tokens`
                                    }
                                  />
                                </PieChart>
                              </ResponsiveContainer>
                              <div className="donut-label">
                                <span>TOTAL TOKENS</span>
                                <strong>{compact(totals.totalTokens)}</strong>
                              </div>
                            </div>
                            <div className="token-legend">
                              {inputBreakdown.map((d) => (
                                <div key={d.name}>
                                  <span
                                    className="legend-dot"
                                    style={{ background: d.color }}
                                  />
                                  <span>{d.name}</span>
                                  <strong>
                                    {shareText(d.value, totals.totalTokens)}
                                  </strong>
                                  <small>{compact(d.value)}</small>
                                </div>
                              ))}
                            </div>
                          </section>
                        </div>
                        <section className="panel activity-panel" id="activity">
                          <div className="panel-heading">
                            <div>
                              <h2>
                                A year of making things{" "}
                                <label className="year-picker">
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
                                </label>
                              </h2>
                              <p>
                                Every square is a day. Every day is a little
                                progress.
                              </p>
                            </div>
                            <div className="activity-count">
                              <strong>
                                {
                                  data.daily.filter(
                                    (d) =>
                                      (d.totalTokens > 0 ||
                                        (byRequests && d.humanRequests > 0)) &&
                                      d.date.startsWith(String(calendarYear)),
                                  ).length
                                }
                              </strong>{" "}
                              active days this year
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
                                role="group"
                                aria-label={
                                  byRequests
                                    ? "Daily activity calendar"
                                    : "Daily token contribution calendar"
                                }
                              >
                                {activity.map((d) => {
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
                                      title={`${d.date} · ${number(d.tokens)} tokens · ${availability.humanRequests ? `${d.requests} human requests` : "human requests unavailable"}${d.future ? " · future date" : ""}`}
                                      aria-label={`${d.date}: ${number(d.tokens)} tokens`}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                          <div className="heatmap-footer">
                            <span>
                              <span className="tiny-spark">✧</span> Consistency
                              looks good on you.
                            </span>
                            <div>
                              Less{" "}
                              {[0, 1, 2, 3, 4].map((n) => (
                                <i key={n} className={`heat-cell level-${n}`} />
                              ))}{" "}
                              More
                            </div>
                          </div>
                        </section>
                        <div className="two-column lower">
                          <section className="panel hours-panel">
                            <div className="panel-heading">
                              <div>
                                <h2>Your creative hours</h2>
                                <p>Token activity by hour · {data.timezone}</p>
                              </div>
                              <Clock3 size={16} className="subdued" />
                            </div>
                            <div className="hour-chart">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                  data={data.hours}
                                  margin={{
                                    left: -18,
                                    right: 6,
                                    top: 12,
                                    bottom: 0,
                                  }}
                                >
                                  <CartesianGrid
                                    stroke="#30342d"
                                    strokeDasharray="3 5"
                                    vertical={false}
                                  />
                                  <XAxis
                                    dataKey="hour"
                                    interval={3}
                                    tickFormatter={(v) =>
                                      `${String(v).padStart(2, "0")}:00`
                                    }
                                    stroke="#777e71"
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={10}
                                  />
                                  <YAxis
                                    tickFormatter={compact}
                                    stroke="#777e71"
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={10}
                                  />
                                  <Tooltip
                                    contentStyle={tooltipStyle}
                                    cursor={{ fill: "#ffffff06" }}
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
                                    fill="#a78bfa"
                                    radius={[3, 3, 0, 0]}
                                  />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </section>
                          <section className="panel spotlight">
                            <div className="spotlight-top">
                              <span className="spotlight-icon">
                                <Zap size={20} />
                              </span>
                              <span>THE POWER SESSION</span>
                              <ArrowUpRight size={17} />
                            </div>
                            <h2>Your biggest 24 hours.</h2>
                            <div className="spotlight-value">
                              {!availability.cost
                                ? "Unavailable"
                                : data.mostExpensive24h
                                  ? money(data.mostExpensive24h.costUsd)
                                  : "—"}
                              <span>API-equivalent value</span>
                            </div>
                            <p>
                              {!availability.cost
                                ? "Requires priced token records."
                                : data.mostExpensive24h
                                ? `${compact(data.mostExpensive24h.tokens)} tokens in your highest-value rolling 24-hour window.`
                                : "Your most active window will appear as usage is recorded."}
                            </p>
                            <div className="spotlight-bottom">
                              <Clock3 size={13} />
                              {data.mostExpensive24h
                                ? `${new Date(data.mostExpensive24h.start).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: data.timezone })} · ${new Date(data.mostExpensive24h.start).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: data.timezone })} → +24 hours`
                                : "Waiting for history"}
                            </div>
                          </section>
                        </div>
                        <section className="panel model-table">
                          <div className="panel-heading">
                            <div>
                              <h2>The model ledger</h2>
                              <p>
                                Input, output, and estimated value. Nothing
                                hidden.
                              </p>
                            </div>
                            <span className="subtle-tag">
                              USD / STANDARD API RATES
                            </span>
                          </div>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>MODEL</th>
                                  <th>INPUT</th>
                                  <th>CACHED INPUT¹</th>
                                  {(isClaude || isCursor) && (
                                    <th>CACHE WRITES¹</th>
                                  )}
                                  <th>OUTPUT</th>
                                  <th>API VALUE</th>
                                </tr>
                              </thead>
                              <tbody>
                                {models.map((m, i) => (
                                  <tr key={m.model}>
                                    <td>
                                      <span
                                        className="legend-dot"
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
                                    {(isClaude || isCursor) && (
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
                          <div className="table-note">
                            ¹ Cached tokens are part of input, not additional
                            tokens. Reasoning is included in output.{" "}
                            <button onClick={() => setInfo(true)}>
                              Pricing & methodology <ArrowUpRight size={11} />
                            </button>
                          </div>
                        </section>
                      </>
                    ) : (
                      <section className="panel import-state" id="models">
                        <Database size={24} />
                        <h2>
                          {isAntigravity
                            ? "No Antigravity conversations found."
                            : "Token graphs need a usage export."}
                        </h2>
                        <p>
                          {isAntigravity
                            ? "Use Antigravity once, or set ANTIGRAVITY_HOME to the folder that contains antigravity/ and antigravity-cli/ (default ~/.gemini). This view re-reads those local databases every 15 seconds."
                            : "Set CURSOR_AUTO_SYNC=true to fetch your usage events from your Cursor account automatically, or export them from your Cursor dashboard and set CURSOR_USAGE_CSV / put exports in data/cursor-imports. This view checks for changes every 15 seconds. Local context-window counters are not treated as billed token records."}
                        </p>
                        {!isAntigravity && (
                          <a
                            className="button"
                            href="https://cursor.com/dashboard/usage"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open Cursor usage <ExternalLink size={13} />
                          </a>
                        )}
                      </section>
                    )}
                    <footer>
                      <span className="footer-brand">
                        <Terminal size={14} /> {brand} atlas <span>·</span> Made
                        of small moments.
                      </span>
                      <span>
                        <span className="live-dot" /> Real history. Live
                        perspective.{" "}
                        <button onClick={() => setInfo(true)}>
                          Data & privacy <ArrowUpRight size={11} />
                        </button>
                      </span>
                    </footer>
                  </>
                )
              )}
            </>
          )}
        </main>
      </div>
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
              className="modal-close icon-button"
              aria-label="Close methodology"
              onClick={() => setInfo(false)}
            >
              <X size={18} />
            </button>
            <div className="eyebrow">
              <Database size={14} /> BEHIND THE NUMBERS
            </div>
            <h2 id="method-title">A clear view of your usage.</h2>
            <p>
              This dashboard measures{" "}
              <strong>retained {product} history</strong>, not a verified
              account lifetime. Deleted sessions, other devices, and cloud-only
              sessions may be missing. Your subscription bill is separate.
            </p>
            <h3>What counts?</h3>
            <p>
              {isCursor
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
                <div className="method-meta">
                  <span>Last collected</span>
                  <strong>{new Date(data.generatedAt).toLocaleString()}</strong>
                  <span>History files scanned</span>
                  <strong>{data.coverage.filesScanned}</strong>
                  <span>Pricing checked</span>
                  <strong>{data.pricing.checkedAt}</strong>
                </div>
                {data.coverage.warnings.map((w, i) => (
                  <p className="method-warning" key={i}>
                    <Info size={13} />
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
            <button className="button primary" onClick={() => setInfo(false)}>
              <Check size={14} /> Got it
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  detail,
  foot,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  detail: React.ReactNode;
  foot: string;
}) {
  return (
    <article className="stat">
      <div className="stat-label">
        {label}
        {icon}
      </div>
      <div
        className={`stat-value ${value === "Unavailable" ? "unavailable" : ""}`}
      >
        {value}
      </div>
      <div className="stat-detail">{detail}</div>
      <div className="stat-foot">{foot}</div>
    </article>
  );
}
