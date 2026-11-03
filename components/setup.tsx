"use client";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy, ExternalLink } from "lucide-react";
import { chooseLocalDashboard } from "@/lib/local-dashboard";
import { hasHistory, loadHarnesses } from "@/lib/overview";
import { deploymentUrl, profileEmbed } from "@/lib/profile-card";
import { DEPLOY_CHANNEL, DEPLOY_PENDING_KEY, deployRedirectTarget, readDeployMessage, SETUP_STEPS, setupStep } from "@/lib/setup-flow";
import { DEFAULT_STORAGE, marketplaceUrl, STORAGE_PROVIDERS, type StorageProviderId } from "@/lib/storage-providers";
import type { SetupState } from "@/lib/instance";
import s from "./setup.module.css";

type Connect = { code: string; origin: string; password?: string };
const POLL_MS = 5_000;

const installCommand = ({ origin, code }: Connect) => `curl -fsSL ${origin}/api/install | sh -s -- ${code}`;

// How long the tab Vercel returns to waits for the setup tab to answer before moving on itself.
const HANDOFF_MS = 800;
const channel = () => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(DEPLOY_CHANNEL));
// "Waiting for your deployment" survives a reload of the setup tab, for this browser session only.
const pending = {
  get: () => { try { return window.sessionStorage.getItem(DEPLOY_PENDING_KEY) === "1"; } catch { return false; } },
  set: (on: boolean) => {
    try { if (on) window.sessionStorage.setItem(DEPLOY_PENDING_KEY, "1"); else window.sessionStorage.removeItem(DEPLOY_PENDING_KEY); }
    catch { /* Storage blocked: the waiting screen just won't survive a reload. */ }
  },
};

// Whether this browser is signed in, and whether any provider has uploaded usage yet. Usage is only
// read on a claimed deployment: no other step depends on it, and on a local copy it means parsing
// every provider's whole history, which can take a while on a cold start.
async function readState() {
  const status = await fetch("/api/setup/status", { cache: "no-store" }).then((r) => r.json() as Promise<SetupState>);
  if (!status.cloud || status.storage !== "ok" || !status.claimed)
    return { status, signedIn: false, hasData: false };
  const usage = await loadHarnesses();
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
  const router = useRouter();
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
  const [storage, setStorage] = useState<StorageProviderId>(DEFAULT_STORAGE);
  // Deploy pressed: Vercel is open in another tab and this one waits for it to finish.
  const [deploying, setDeploying] = useState(false);
  // This tab is the one Vercel sent back; the setup tab took over, so it only says so.
  const [handedOff, setHandedOff] = useState<string | null>(null);
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

  // Coming back from Vercel's deploy flow. If the setup tab is still open and waiting, hand over to
  // it (it moves on to the new site) and close this tab; otherwise carry on at the new site here.
  useEffect(() => {
    const target = deployRedirectTarget(new URLSearchParams(window.location.search).get("deployment-url"));
    if (target) {
      pending.set(false);
      const bus = channel();
      if (!bus) {
        window.location.replace(target);
        return;
      }
      let answered = false;
      bus.onmessage = (event) => {
        if (readDeployMessage(event.data)?.type !== "taken" || answered) return;
        answered = true;
        setHandedOff(target);
        window.close(); // Allowed for the tab the setup page opened; otherwise the message below stays.
      };
      bus.postMessage({ type: "deployed", target });
      const timer = setTimeout(() => { if (!answered) window.location.replace(target); }, HANDOFF_MS);
      return () => { clearTimeout(timer); bus.close(); };
    }
    const timer = setTimeout(() => {
      setHere(window.location.origin);
      setDeploying(pending.get());
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // The waiting tab: when Vercel's tab reports the new site, answer it and move on to that site.
  useEffect(() => {
    if (!deploying) return;
    const bus = channel();
    if (!bus) return;
    bus.onmessage = (event) => {
      const message = readDeployMessage(event.data);
      if (message?.type !== "deployed") return;
      bus.postMessage({ type: "taken" });
      pending.set(false);
      window.location.assign(message.target);
    };
    return () => bus.close();
  }, [deploying]);

  function startDeploy() {
    const link = deploymentUrl(undefined, { storage, redirect: `${window.location.origin}/setup` });
    pending.set(true);
    setDeploying(true);
    // A new tab keeps this one waiting. "noopener" keeps vercel.com from reaching back into this page.
    window.open(link, "_blank", "noopener");
  }
  function stopWaiting() {
    pending.set(false);
    setDeploying(false);
    setManual(null);
  }

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
    pending.set(false);
    // Another site entirely, so a full navigation rather than the client router.
    window.location.assign(new URL("/setup", origin).href);
  }

  const notice = error ? <p className={s.error} role="alert">{error}</p> : null;
  const siteForm = (
    <form className={s.inline} onSubmit={openSite}>
      <input className={s.input} value={manual ?? ""} onChange={(e) => { setManual(e.target.value); setError(""); }}
        placeholder="my-site.vercel.app" aria-label="Your deployed site address" inputMode="url" />
      <button className={s.secondary} type="submit">Continue</button>
    </form>
  );

  if (handedOff) {
    return (
      <Step step={2} title="Your site is deployed" lead="Setup continues in your other tab. You can close this one.">
        <a className={s.secondary} href={handedOff}>Continue here instead <ArrowRight size={16} /></a>
      </Step>
    );
  }

  if (!current) {
    return (
      <Step step={1} title="Setting up" lead="Checking your site…">
        {notice}
        {error && <button className={s.link} onClick={() => void load()}>Try again</button>}
      </Step>
    );
  }

  if (current.view === "deploy" && deploying) {
    return (
      <Step step={1} title="Waiting for your deployment" lead="Finish deploying in the Vercel tab. When it’s done, this page moves on by itself.">
        <p className={s.waiting} role="status"><span className={s.pulse} aria-hidden="true" /> Waiting for Vercel…</p>
        <button className={s.secondary} onClick={startDeploy}>Open Vercel again <ExternalLink size={16} /></button>
        <p className={s.hint}>
          When Vercel says your project is deployed, use its button to return here. If you left Vercel another way,
          enter the address it gave your site:
        </p>
        {siteForm}
        {notice}
        <button className={s.link} onClick={stopWaiting}>Back</button>
      </Step>
    );
  }

  if (current.view === "deploy") {
    return (
      <Step step={1} title="Deploy your own copy" lead="Vercel copies this project to your GitHub and creates a free database. It takes about a minute.">
        <fieldset className={s.choices}>
          <legend className={s.secretLabel}>Database</legend>
          {STORAGE_PROVIDERS.map((provider) => (
            <label key={provider.id} className={s.choice}>
              <input type="radio" name="storage" value={provider.id} checked={storage === provider.id}
                onChange={() => setStorage(provider.id)} />
              <span className={s.choiceName}>{provider.name}</span>
              <span className={s.choiceNote}>{provider.free}</span>
            </label>
          ))}
        </fieldset>
        <button className={s.primary} onClick={startDeploy} disabled={!here}>
          Deploy to Vercel <ExternalLink size={16} />
        </button>
        <p className={s.hint}>Used up a free plan already? Pick another, or connect a database you already have when Vercel asks.</p>
        {notice}
        {manual === null ? (
          <button className={s.link} onClick={() => setManual("")}>Already deployed? Enter your site address</button>
        ) : siteForm}
        <button className={s.link} onClick={() => { chooseLocalDashboard(); router.push("/"); }}>
          Visit dashboard on this computer
        </button>
      </Step>
    );
  }

  if (current.view === "storage") {
    return (
      <Step step={1} title="Connect your database" lead="Add any one of these free databases to this project in Vercel, then redeploy.">
        <div className={s.providers}>
          {STORAGE_PROVIDERS.map((provider) => (
            <a key={provider.id} className={s.secondary} href={marketplaceUrl(provider)} target="_blank" rel="noreferrer">
              {provider.name} <ExternalLink size={14} />
            </a>
          ))}
        </div>
        <p className={s.hint}>Choose your vibe-check project when Vercel asks where to connect it. Another Redis or Postgres host works too: set REDIS_URL or DATABASE_URL yourself.</p>
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
        {status?.cloud ? (
          <>
            <button className={s.link} onClick={() => { setConnecting(true); setConnect(null); }}>Connect another computer</button>
            {" · "}
            <Link className={s.link} href="/all">Open dashboard</Link>
          </>
        ) : status?.site ? (
          // The dashboard is only viewed on the deployed site.
          <a className={s.link} href={`${status.site}/all`}>Open your dashboard ↗</a>
        ) : null}
      </p>
    </Step>
  );
}
