"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Fingerprint, Info,
  Layers3, LoaderCircle, LockKeyhole, RefreshCw, Terminal, Zap } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ProviderNavigation from "./provider-navigation";
import { PROVIDERS, providerName } from "@/lib/providers";
import { hasHistory, loadHarnesses, metricAvailable, summarizeHarnesses } from "@/lib/overview";
import type { HarnessUsage } from "@/lib/overview";
import type { MetricAvailability, UsageProvider } from "@/lib/types";

const COLORS: Record<UsageProvider, string> = {
  codex: "#a3e635", claude: "#e8a67b", cursor: "#8ac5f7", antigravity: "#aa8af7",
};
const hrefFor = (provider: UsageProvider) => provider === "codex" ? "/" : `/${provider}`;
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const compact = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export default function AllDashboard() {
  const router = useRouter();
  const refreshing = useRef(false);
  const [harnesses, setHarnesses] = useState<HarnessUsage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checked, setChecked] = useState("");
  const summary = useMemo(() => summarizeHarnesses(harnesses), [harnesses]);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setBusy(true);
    try {
      const result = await loadHarnesses();
      setHarnesses(result.harnesses);
      setLocked(result.locked);
      setLoaded(true);
      setChecked(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      if (result.locked) {
        void fetch("/api/setup/status", { cache: "no-store" }).then((r) => r.json()).then((s) => {
          if (s?.cloud && s.storage === "ok" && !s.claimed) router.push("/setup");
        }).catch(() => {});
      }
    } finally {
      refreshing.current = false;
      setBusy(false);
    }
  }, [router]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 15_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Sign-in failed.");
      setPassword("");
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ harnesses }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "all-atlas-usage.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  const coverage = (metric: keyof MetricAvailability) =>
    `${summary.reporting(metric)} of ${summary.connected.length} harnesses with history report this metric`;
  const value = (metric: keyof MetricAvailability, amount: number, format = compact) =>
    summary.reporting(metric) ? format(amount) : "Unavailable";
  const failures = harnesses.filter((h) => h.error);

  return (
    <div className="shell all-dashboard">
      <aside className="sidebar">
        <Link className="brand" href="/all" aria-label="All Atlas home">
          <span className="brand-icon"><Layers3 size={22} /></span>
          <span>all<span className="brand-light">atlas</span><small>YOUR PERSONAL OBSERVATORY</small></span>
        </Link>
        <div className="workspace">
          <div className="avatar">D</div>
          <div>Personal workspace<small>All harnesses <span>PERSONAL</span></small></div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Overview sections">
          <a className="active" href="#overview"><Layers3 size={17} />Overview<span className="nav-dot" /></a>
          <a href="#harnesses"><Terminal size={17} />Harnesses</a>
          <a href="#activity"><Activity size={17} />Activity</a>
        </nav>
        <div className="sidebar-note">
          <div className="note-icon"><Fingerprint size={19} /></div>
          <strong>Your data. Your perspective.</strong>
          <p>Usage numbers only. Your conversations stay with you.</p>
          <a href="#methodology">How it works <ArrowUpRight size={13} /></a>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div><span className="breadcrumb">Workspace</span><span className="slash">/</span>Overview</div>
          <div className="topbar-right"><ProviderNavigation selected="all" /><div className="avatar small">D</div></div>
        </header>
        <main id="overview">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span /> THE WHOLE PICTURE</div>
              <h1>All your work, together<span>.</span></h1>
              <p>Your overall usage across Codex, Claude Code, Cursor and Antigravity.</p>
            </div>
            <div className="heading-actions">
              <button className="icon-button" aria-label="Refresh usage" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw size={16} className={busy ? "spin" : ""} />
              </button>
              <button className="button" disabled={!loaded || locked} onClick={download}><ArrowDownToLine size={14} />Export data</button>
            </div>
          </div>
          {locked ? (
            <section className="panel login">
              <LockKeyhole size={28} /><h2>Your observatory is private.</h2>
              <p>Enter the dashboard password to see your usage.</p>
              <form onSubmit={login}>
                <input type="password" autoComplete="current-password" aria-label="Dashboard password" placeholder="Dashboard password"
                  value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button className="button primary" disabled={busy}>Unlock <ArrowRight size={15} /></button>
              </form>
              {error && <p role="alert" className="error">{error}</p>}
            </section>
          ) : !loaded ? (
            <section className="loading"><LoaderCircle className="spin" /><h2>Reading your connected harnesses</h2></section>
          ) : (
            <>
              <div className="status-row">
                <span className="live"><span />ALL RECORDED HISTORY</span>
                <span className="status-text">{summary.connected.length} harnesses with recorded usage</span>
                <span className="updated">Checked {checked} · refreshes every 15s</span>
              </div>
              {failures.length > 0 && <div className="error-banner" role="alert"><Info size={16} />
                <span>Partial overview: {failures.map((h) => providerName(h.provider)).join(", ")} could not be loaded and are excluded from totals. See details below.</span>
                <button onClick={() => void refresh()} disabled={busy}>Try again</button>
              </div>}
              <section className="stats-grid" aria-label="Overall recorded usage">
                {[
                  { label: "TOTAL TOKENS", amount: value("tokens", summary.tokens), detail: coverage("tokens"), icon: Layers3, foot: "Across all recorded history" },
                  { label: "API-EQUIVALENT VALUE", amount: value("cost", summary.cost, money), detail: coverage("cost"), icon: Zap,
                    foot: summary.unpricedTokens ? `${compact(summary.unpricedTokens)} tokens have no cost estimate` : "Estimate in USD · not your subscription bill" },
                  { label: "RECORDED SESSIONS", amount: value("sessions", summary.sessions, number), detail: coverage("sessions"), icon: Terminal, foot: "Sessions recorded by each harness" },
                  { label: "HUMAN REQUESTS", amount: value("humanRequests", summary.requests, number), detail: coverage("humanRequests"), icon: Activity, foot: "Requests recorded by each harness" },
                ].map(({ label, amount, detail, icon: Icon, foot }) => (
                  <article className="stat" key={label}>
                    <div className="stat-label">{label}<Icon size={16} /></div>
                    <div className={`stat-value ${amount === "Unavailable" ? "unavailable" : ""}`}>{amount}</div>
                    <div className="stat-detail">{detail}</div><div className="stat-foot">{foot}</div>
                  </article>
                ))}
              </section>
              <section className="panel model-panel" id="harnesses">
                <div className="panel-heading"><div><h2>Usage by harness</h2><p>Each harness’s contribution to your recorded token usage.</p></div>
                  <span className="mono subdued">{number(summary.tokens)} reported tokens</span></div>
                {summary.tokens > 0 && <div className="model-stack" role="img" aria-label="Token share by harness">
                  {summary.connected.filter(({ snapshot }) => metricAvailable(snapshot, "tokens")).map(({ provider, snapshot }) => (
                    <div key={provider} style={{ width: `${snapshot.totals.totalTokens / summary.tokens * 100}%`, background: COLORS[provider] }}
                      title={`${providerName(provider)}: ${number(snapshot.totals.totalTokens)} tokens`} />
                  ))}
                </div>}
                <div className="all-table-scroll">
                  <table className="all-harness-table">
                    <thead><tr><th>HARNESS</th><th>TOKENS</th><th>SHARE</th><th>SESSIONS</th><th>HUMAN REQUESTS</th><th>API VALUE</th></tr></thead>
                    <tbody>{harnesses.map(({ provider, snapshot, error }) => {
                      const recorded = snapshot && hasHistory(snapshot);
                      const metric = (key: keyof MetricAvailability, amount: number, format = compact) =>
                        recorded && metricAvailable(snapshot, key) ? format(amount) : "—";
                      return <tr key={provider}>
                        <td><Link href={hrefFor(provider)}><span className="legend-dot" style={{ background: COLORS[provider] }} />{providerName(provider)} <ArrowUpRight size={12} /></Link>
                          <small>{error || (!recorded ? "No recorded history" : `Collected ${new Date(snapshot.generatedAt).toLocaleString()}`)}</small></td>
                        <td title={recorded && metricAvailable(snapshot, "tokens") ? number(snapshot.totals.totalTokens) : "Tokens unavailable"}>{snapshot ? metric("tokens", snapshot.totals.totalTokens) : "—"}</td>
                        <td>{recorded && metricAvailable(snapshot, "tokens") && summary.tokens > 0
                          ? `${(snapshot.totals.totalTokens / summary.tokens * 100).toFixed(1)}%` : "—"}</td>
                        <td>{snapshot ? metric("sessions", snapshot.totals.sessions, number) : "—"}</td>
                        <td>{snapshot ? metric("humanRequests", snapshot.totals.humanRequests, number) : "—"}</td>
                        <td>{snapshot ? metric("cost", snapshot.totals.costUsd, money) : "—"}
                          {recorded && snapshot.totals.unpricedTokens > 0 && <small>+ unpriced tokens</small>}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
                <div className="table-note">— means this metric or history is unavailable. Totals include only reported metrics.</div>
              </section>
              <section className="panel trend-panel all-trend" id="activity">
                <div className="panel-heading"><div><h2>Your daily usage, together</h2><p>Recorded tokens per day, broken down by harness.</p></div></div>
                <div className="model-legend">{PROVIDERS.map((provider) => <span key={provider}><span className="legend-dot" style={{ background: COLORS[provider] }} />{providerName(provider)}</span>)}</div>
                {summary.daily.some((day) => PROVIDERS.some((provider) => day[provider] > 0)) ? (
                  <div className="all-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={summary.daily} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#30342a" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={(date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} stroke="#92998a" fontSize={10} minTickGap={35} />
                        <YAxis tickFormatter={compact} stroke="#92998a" fontSize={10} width={50} />
                        <Tooltip contentStyle={{ background: "#202322", border: "1px solid #3a3e37", borderRadius: 10, color: "#f1f1ed" }} formatter={(value, name) => [number(Number(value)), name]} />
                        {PROVIDERS.map((provider) => <Area key={provider} type="linear" dataKey={provider} name={providerName(provider)} stackId="tokens" stroke={COLORS[provider]} fill={COLORS[provider]} fillOpacity={0.25} isAnimationActive={false} />)}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="all-empty"><Activity size={24} /><h3>No recorded tokens yet</h3><p>Collect or sync usage from a harness to see your daily activity here.</p></div>}
              </section>
              <section className="panel all-methodology" id="methodology">
                <h2><Info size={16} /> About these totals</h2>
                <p>This overview adds the retained usage reported by each harness. Missing exports, deleted sessions, other devices and unsynced history are not included. API-equivalent values are estimates, not subscription charges.</p>
                <p>Sessions and requests follow each harness’s definitions. Days use each source’s recorded timezone; overlapping imports across harnesses are not deduplicated.</p>
                {summary.connected.some(({ snapshot }) => snapshot.source === "cloud") && <p>Cloud totals reflect each harness’s last uploaded snapshot. Check collection times above for stale or unsynced history.</p>}
                <details>
                  <summary>Source details by harness</summary>
                  {summary.connected.map(({ provider, snapshot }) => snapshot.coverage.warnings.length > 0 && <p key={provider}><strong>{providerName(provider)}:</strong> {snapshot.coverage.warnings.join(" ")}</p>)}
                </details>
              </section>
              <footer><span className="footer-brand"><Layers3 size={14} /> all atlas</span><span>Usage numbers only. Your conversations stay with you.</span></footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
