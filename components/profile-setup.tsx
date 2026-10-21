"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Code2 } from "lucide-react";
import { cardMetrics, deploymentUrl, profileEmbed, type CardMetric, type CardTheme } from "@/lib/profile-card";
import type { UsageProvider } from "@/lib/types";

export default function ProfileSetup() {
  const [provider, setProvider] = useState<UsageProvider>("codex");
  const [theme, setTheme] = useState<CardTheme>("dark");
  const [metrics, setMetrics] = useState<CardMetric[]>(["tokens", "sessions"]);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  let markdown = "", originError = "";
  try { markdown = profileEmbed(origin, provider, theme, metrics).markdown; }
  catch (error) { originError = (error as Error).message; }
  const preview = `/api/card?${new URLSearchParams({ provider, theme, metrics: metrics.join(","), v: String(previewVersion) })}`;
  function changed() { setCopied(false); setMessage(""); }
  async function copy() {
    try { await navigator.clipboard.writeText(markdown); setCopied(true); setMessage("Markdown copied. Paste it into your profile README."); }
    catch { setMessage("Clipboard unavailable. Select and copy the Markdown below."); }
  }
  return (
    <main className="profile-setup">
      <Link className="profile-back" href="/"><ArrowLeft size={15} /> Back to dashboard</Link>
      <header className="profile-heading">
        <div className="eyebrow"><Code2 size={16} /> BUILT FOR YOUR GITHUB PROFILE</div>
        <h1>Your usage. On display<span>.</span></h1>
        <p>Turn your recorded AI usage into a card for your profile README. Host your own instance and choose what to share.</p>
      </header>
      <div className="profile-grid">
        <section className="panel profile-step">
          <span className="profile-step-number">GET STARTED / 2 STEPS</span>
          <h2>Make it yours</h2>
          <p><strong>1.</strong> Deploy your own copy. Vercel creates your free Redis database for you, so there is nothing to fill in.</p>
          <a className="button primary profile-deploy" href={deploymentUrl()} target="_blank" rel="noreferrer">Deploy to Vercel ↗</a>
          <p><strong>2.</strong> Open your new site and press <em>Claim this dashboard</em>. It gives you one command to run on the computer that holds your usage history. It installs the collector and keeps your stats updated.</p>
          <Link className="button" href="/setup">Open setup</Link>
          <p>Uploads contain usage aggregates, never conversations or account credentials. Use one collector per provider; multiple computers are not combined.</p>
        </section>
        <section className="panel profile-step profile-card-builder">
          <span className="profile-step-number">03 / CUSTOMIZE</span>
          <h2>Choose your card</h2>
          <div className="profile-controls">
            <label>Provider<select value={provider} onChange={(e) => { setProvider(e.target.value as UsageProvider); setPreviewError(false); changed(); }}>
              <option value="codex">Codex</option><option value="claude">Claude Code</option><option value="cursor">Cursor</option><option value="antigravity">Antigravity</option>
            </select></label>
            <label>Theme<select value={theme} onChange={(e) => { setTheme(e.target.value as CardTheme); setPreviewError(false); changed(); }}>
              <option value="dark">Dark</option><option value="light">Light</option>
            </select></label>
          </div>
          <fieldset><legend>Public metrics</legend>{cardMetrics.map((metric) => <label key={metric} className="profile-checkbox"><input type="checkbox" checked={metrics.includes(metric)} disabled={metrics.length === 1 && metrics.includes(metric)} onChange={() => { setMetrics(metrics.includes(metric) ? metrics.filter((m) => m !== metric) : [...metrics, metric]); setPreviewError(false); changed(); }} />{metric === "requests" ? "Human requests" : metric === "tokens" ? "Tokens" : "Sessions"}</label>)}</fieldset>
          <p>Preview of this instance’s public card. Selected metrics only affect this image; enabling a provider makes all of its summary totals (tokens, sessions, human requests) and its activity calendar available to anyone with the link. The calendar shows per-day intensity for the last 12 months, so which days were active can be inferred. Metrics missing from a source show “Unavailable”.</p>
          <div className={`profile-preview ${theme}`}>
            {/* SVG is a dynamic public endpoint; next/image optimization is unnecessary. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={preview} src={preview} alt="Your public usage card preview" width="560" height="200" hidden={previewError} onError={() => setPreviewError(true)} />
            {previewError && <p role="status">No public card available yet. Claim your dashboard and run the connect command on <Link href="/setup">the setup page</Link>; the card appears after the first sync. Set <code>PUBLIC_*_WIDGET=false</code> to keep a provider private.</p>}
          </div>
          <button className="button" onClick={() => { setPreviewError(false); setPreviewVersion(previewVersion + 1); }}>Reload preview</button>
        </section>
        <section className="panel profile-step">
          <span className="profile-step-number">04 / EMBED</span>
          <h2>Put it on your profile</h2>
          <label htmlFor="public-origin">Your deployed dashboard URL</label>
          <input id="public-origin" type="url" placeholder="https://your-instance.vercel.app" value={origin} onChange={(e) => { setOrigin(e.target.value); changed(); }} aria-describedby="origin-help" />
          <button className="profile-origin" onClick={() => { setOrigin(window.location.origin); changed(); }}>Use this website’s URL</button>
          <p id="origin-help">{origin && originError ? originError : "Use a public HTTPS address. GitHub cannot load images from localhost."}</p>
          <label htmlFor="profile-markdown">README Markdown</label>
          <textarea id="profile-markdown" readOnly rows={5} value={markdown} placeholder="Enter your deployed URL to generate your embed." />
          <button className="button" disabled={!markdown} onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy Markdown"}</button>
          <p role="status" aria-live="polite">{message}</p>
          <p>Create a public GitHub repository named exactly like your username, add a <code>README.md</code>, and paste the Markdown there.</p>
          <p>Your dashboard remains password protected. Anyone can view and cache an enabled card. GitHub caches images, so profile updates can lag behind uploads. Disabling sharing stops new reads after caches expire.</p>
          <a href="https://docs.github.com/en/account-and-profile/how-tos/profile-customization/managing-your-profile-readme" target="_blank" rel="noreferrer">GitHub’s profile README guide ↗</a>
        </section>
      </div>
    </main>
  );
}
