"use client";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, ExternalLink } from "lucide-react";
import { hasHistory, loadHarnesses } from "@/lib/overview";
import { deploymentUrl, profileEmbed } from "@/lib/profile-card";
import { deployRedirectTarget, SETUP_STEPS, setupStep } from "@/lib/setup-flow";
import type { SetupState } from "@/lib/instance";
import s from "./setup.module.css";

type Connect = { code: string; origin: string; password?: string };
const POLL_MS = 5_000;

const installCommand = ({ origin, code }: Connect) => `curl -fsSL ${origin}/api/install | sh -s -- ${code}`;

// Whether this browser is signed in, and whether any provider has uploaded usage yet.
async function readState() {
  const [status, usage] = await Promise.all([
    fetch("/api/setup/status", { cache: "no-store" }).then((r) => r.json() as Promise<SetupState>),
    loadHarnesses(),
  ]);
  return {
    status,
    signedIn: !usage.locked,
    hasData: usage.harnesses.some((h) => h.snapshot && hasHistory(h.snapshot)),
  };
}

function useCopy() {
  const [copied, setCopied] = useState("");
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? "" : current)), 2000);
    } catch {
      /* Clipboard blocked: the text stays selectable on the page. */
    }
  };
  return { copied, copy };
}

function Step({ step, title, lead, children }: { step: number; title: string; lead: string; children?: ReactNode }) {
  return (
    <main className={s.page}>
      <div className={s.top}>
        <div className={s.track} role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={SETUP_STEPS} aria-valuenow={step}>
          <div className={s.fill} style={{ width: `${(step / SETUP_STEPS) * 100}%` }} />
        </div>
        <span className={s.count}>{step}/{SETUP_STEPS}</span>
      </div>
      <section className={s.body}>
        <h1 className={s.title}>{title}</h1>
        <p className={s.lead}>{lead}</p>
        {children}
      </section>
    </main>
  );
}

export default function Setup() {
  const [status, setStatus] = useState<SetupState | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [connect, setConnect] = useState<Connect | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [here, setHere] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  const load = useCallback(async () => {
    try {
      const next = await readState();
      setStatus(next.status);
      setSignedIn(next.signedIn);
      setHasData(next.hasData);
      setError("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
  }, []);

  // Coming back from Vercel's deploy flow: carry on at the new site's setup page.
  useEffect(() => {
    const target = deployRedirectTarget(new URLSearchParams(window.location.search).get("deployment-url"));
    if (target) {
      window.location.replace(target);
      return;
    }
    const timer = setTimeout(() => {
      setHere(window.location.origin);
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const current = status ? setupStep(status, { signedIn, hasData, connecting }) : null;

  // While the connect page is open, watch for the collector's first upload and move on by itself.
  const waiting = current?.view === "connect" && signedIn && !hasData;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function post(url: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error || "Something went wrong. Try again.");
        await load();
        return null;
      }
      return body as { password?: string; pairingCode: string; origin: string };
    } catch {
      setError("Could not reach the server. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function getCommand() {
    const claiming = status?.cloud && status.storage === "ok" && !status.claimed;
    const body = await post(claiming ? "/api/setup/claim" : "/api/setup/pair");
    if (!body) return;
    setConnect({ code: body.pairingCode, origin: body.origin, password: body.password });
    if (claiming) {
      setSignedIn(true);
      setStatus({ cloud: true, storage: "ok", claimed: true, managedByEnv: false });
    }
  }
  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Sign-in failed.");
      setPassword("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  function openSite(event: FormEvent) {
    event.preventDefault();
    const raw = (manual ?? "").trim();
    let origin = "";
    try {
      origin = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
      profileEmbed(origin, "all", "dark", ["tokens"]); // Same rules GitHub needs: public HTTPS.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enter your site address, like my-site.vercel.app.");
      return;
    }
    // Another site entirely, so a full navigation rather than the client router.
    window.location.assign(new URL("/setup", origin).href);
  }

  const notice = error ? <p className={s.error} role="alert">{error}</p> : null;

  if (!current) {
    return (
      <Step step={1} title="Setting up" lead="Checking your site…">
        {notice}
        {error && <button className={s.link} onClick={() => void load()}>Try again</button>}
      </Step>
    );
  }

  if (current.view === "deploy") {
    return (
      <Step step={1} title="Deploy your own copy" lead="Vercel copies this project to your GitHub and creates a free database. It takes about a minute.">
        <a className={s.primary} href={here ? deploymentUrl(undefined, { redirect: `${here}/setup` }) : deploymentUrl()}>
          Deploy to Vercel <ExternalLink size={16} />
        </a>
        {notice}
        {manual === null ? (
          <button className={s.link} onClick={() => setManual("")}>Already deployed? Enter your site address</button>
        ) : (
          <form className={s.inline} onSubmit={openSite}>
            <input className={s.input} value={manual} onChange={(e) => { setManual(e.target.value); setError(""); }}
              placeholder="my-site.vercel.app" aria-label="Your deployed site address" autoFocus inputMode="url" />
            <button className={s.secondary} type="submit">Continue</button>
          </form>
        )}
      </Step>
    );
  }

  if (current.view === "storage") {
    return (
      <Step step={1} title="Connect your database" lead="In Vercel, open Storage, add Upstash for Redis to this project, then redeploy.">
        <a className={s.primary} href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">
          Open Vercel <ExternalLink size={16} />
        </a>
        {notice}
        <button className={s.link} onClick={() => void load()}>I’ve done it, check again</button>
      </Step>
    );
  }

  if (current.view === "sign-in") {
    return (
      <Step step={2} title="Sign in to continue" lead="Enter the dashboard password you saved when you set up this site.">
        <form className={s.inline} onSubmit={signIn}>
          <input className={s.input} type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Dashboard password" aria-label="Dashboard password" autoFocus />
          <button className={s.primary} type="submit" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        {notice}
        <p className={s.hint}>Lost it? Delete the project in Vercel and deploy again.</p>
      </Step>
    );
  }

  if (current.view === "connect") {
    return (
      <Step step={2} title="Connect your computer" lead="Paste this command into a terminal on the computer you use for AI coding.">
        {connect ? (
          <>
            <pre className={s.code}><code>{installCommand(connect)}</code></pre>
            <button className={s.primary} onClick={() => void copy("command", installCommand(connect))}>
              {copied === "command" ? <Check size={16} /> : <Copy size={16} />} {copied === "command" ? "Copied" : "Copy command"}
            </button>
            {connect.password && (
              <div className={s.secret}>
                <div>
                  <span className={s.secretLabel}>Password (save it)</span>
                  <code className={s.secretValue}>{connect.password}</code>
                  <span className={s.hint}>Needed to sign in after today or on another device. Shown only once.</span>
                </div>
                <button className={s.secondary} onClick={() => void copy("password", connect.password!)}>
                  {copied === "password" ? "Copied" : "Copy"}
                </button>
              </div>
            )}
            {notice}
            {hasData ? (
              <button className={s.link} onClick={() => { setConnecting(false); setConnect(null); }}>Done, continue to step 3</button>
            ) : (
              <p className={s.waiting} role="status"><span className={s.pulse} aria-hidden="true" /> Waiting for your first upload… This page moves on by itself.</p>
            )}
            <p className={s.hint}>macOS or Linux, with Node.js 24 and git. Only usage totals are uploaded. The code expires in 15 minutes.{" "}
              <button className={s.link} onClick={() => void getCommand()} disabled={busy}>New code</button></p>
          </>
        ) : (
          <>
            <button className={s.primary} onClick={() => void getCommand()} disabled={busy}>
              {busy ? "Preparing…" : "Get my command"}
            </button>
            {notice}
            {status?.cloud && status.storage === "ok" && !status.claimed && (
              <p className={s.hint}>This also makes you the owner of this site. Do it now: the first person to press it owns it.</p>
            )}
          </>
        )}
      </Step>
    );
  }

  return (
    <Step step={3} title="Put it on your profile" lead="Preview your README with your real numbers, then publish it to GitHub.">
      <Link className={s.primary} href="/edit">Open README editor <ArrowRight size={16} /></Link>
      {notice}
      <p className={s.hint}>
        <button className={s.link} onClick={() => { setConnecting(true); setConnect(null); }}>Connect another computer</button>
        {" · "}
        <Link className={s.link} href="/all">Open dashboard</Link>
      </p>
    </Step>
  );
}
