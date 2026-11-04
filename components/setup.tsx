"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import { chooseLocalDashboard } from "@/lib/local-dashboard";
import { Headline } from "@/components/vibe-check-chrome";
import { hasHistory, loadHarnesses } from "@/lib/overview";
import { deploymentUrl, profileEmbed } from "@/lib/profile-card";
import { DEPLOY_CHANNEL, DEPLOY_PENDING_KEY, deployRedirectTarget, readDeployMessage, SETUP_STEPS, setupStep } from "@/lib/setup-flow";
import { DEFAULT_STORAGE, marketplaceUrl, STORAGE_PROVIDERS, type StorageProviderId } from "@/lib/storage-providers";
import type { SetupState } from "@/lib/instance";
import s from "./setup.module.css";

type Connect = { code: string; origin: string; password?: string };
const POLL_MS = 5_000;
// Text-style buttons and links share the site-wide underlined link look.
const LINK = "text-link";

// Tells a local copy which site was just deployed, so its setup offers to reconnect to that site
// later instead of deploying again. `keepalive` lets it finish while this tab moves to that site.
const rememberDeployedSite = (site: string) => {
  void fetch("/api/setup/site", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site }), keepalive: true,
  }).catch(() => undefined); // Only a local copy keeps it; a deployed site answers 404.
};

const installCommand = ({ origin, code }: Connect) => `curl -fsSL ${origin}/api/install | sh -s -- ${code}`;

// How long the tab Vercel returns to waits for the setup tab to answer before moving on itself.
const HANDOFF_MS = 800;
const channel = () => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(DEPLOY_CHANNEL));
// "Waiting for your deployment" survives a reload of the setup tab, for this browser session only.
// It also keeps the site already known when the deploy started ("1" when none), so an old site
// doesn't end the wait for a new copy.
const NO_SITE = "1";
const pending = {
  get: (): { before: string | null } | null => {
    try {
      const value = window.sessionStorage.getItem(DEPLOY_PENDING_KEY);
      return value === null ? null : { before: value === NO_SITE ? null : value };
    } catch { return null; }
  },
  set: (on: false | { before: string | null }) => {
    try { if (on) window.sessionStorage.setItem(DEPLOY_PENDING_KEY, on.before ?? NO_SITE); else window.sessionStorage.removeItem(DEPLOY_PENDING_KEY); }
    catch { /* Storage blocked: the waiting screen just won't survive a reload. */ }
  },
};

// Leave the waiting screen for the newly deployed site.
function moveToSite(target: string) {
  pending.set(false);
  rememberDeployedSite(target);
  window.location.assign(target);
}

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

function Step({ step, title, accent, lead, children }: { step: number; title: string; accent?: string; lead: string; children?: ReactNode }) {
  return (
    <main className={s.page}>
      <div className={s.top}>
        <div className={s.track} role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={SETUP_STEPS} aria-valuenow={step}>
          <div className={s.fill} style={{ width: `${(step / SETUP_STEPS) * 100}%` }} />
        </div>
        <span className={s.count}>{step}/{SETUP_STEPS}</span>
      </div>
      <section className={s.body}>
        <Headline text={title} accent={accent} />
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
  // The waiting page keeps its fallbacks (reopen Vercel, type the address) out of the way until asked.
  const [stuck, setStuck] = useState(false);
  // This tab is the one Vercel sent back; the setup tab took over, so it only says so.
  const [handedOff, setHandedOff] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  // "Deploy a new copy instead" sets aside the site this copy already knows. It stays set aside
  // (also while deploying), so only a newly linked or newly known site ends the wait.
  const [setAside, setSetAside] = useState<string | null>(null);
  const setAsideRef = useRef<string | null>(null);
  const putAside = useCallback((site: string | null) => { setAsideRef.current = site; setSetAside(site); }, []);

  const load = useCallback(async () => {
    try {
      const next = await readState();
      setStatus(next.status);
      // A deploy is over once this copy has a site (linked, or known) or is the deployed site itself.
      if (next.status.cloud || next.status.site || (next.status.deployed && next.status.deployed !== setAsideRef.current)) {
        pending.set(false);
        setDeploying(false);
        setStuck(false);
        putAside(null);
      }
      setSignedIn(next.signedIn);
      setHasData(next.hasData);
      setError("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
  }, [putAside]);

  // Coming back from Vercel's deploy flow. If the setup tab is still open and waiting, hand over to
  // it (it moves on to the new site) and close this tab; otherwise carry on at the new site here.
  useEffect(() => {
    const target = deployRedirectTarget(new URLSearchParams(window.location.search).get("deployment-url"));
    if (target) {
      pending.set(false);
      rememberDeployedSite(target);
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
      const waiting = pending.get();
      putAside(waiting?.before ?? null);
      setDeploying(waiting !== null);
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load, putAside]);

  // The waiting tab: when Vercel's tab reports the new site, answer it and move on to that site.
  useEffect(() => {
    if (!deploying) return;
    const bus = channel();
    if (!bus) return;
    bus.onmessage = (event) => {
      const message = readDeployMessage(event.data);
      if (message?.type !== "deployed") return;
      bus.postMessage({ type: "taken" });
      moveToSite(message.target);
    };
    return () => bus.close();
  }, [deploying]);

  function startDeploy() {
    const link = deploymentUrl(undefined, { storage, redirect: `${window.location.origin}/setup` });
    pending.set({ before: setAsideRef.current });
    setDeploying(true);
    // A new tab keeps this one waiting. "noopener" keeps vercel.com from reaching back into this page.
    window.open(link, "_blank", "noopener");
  }
  function stopWaiting() {
    pending.set(false);
    setDeploying(false);
    setStuck(false);
    setManual(null);
  }

  // A set-aside site is treated as unknown, so setup offers a fresh deploy instead of reconnecting.
  const shown = status && !status.cloud && setAside && status.deployed === setAside ? { ...status, deployed: null } : status;
  const current = shown ? setupStep(shown, { signedIn, hasData, connecting }) : null;

  // While waiting for a deploy, watch this computer rather than Vercel: Vercel may never send the user
  // back, and the new site can have any name. The new site's connect command links this computer,
  // after which the status names the site and the wizard moves on by itself.
  const awaitingDeploy = deploying && current?.view === "deploy";
  useEffect(() => {
    if (!awaitingDeploy) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [awaitingDeploy, load]);

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
    rememberDeployedSite(origin);
    // Another site entirely, so a full navigation rather than the client router.
    window.location.assign(new URL("/setup", origin).href);
  }

  const notice = error ? <p className={`error-banner ${s.error}`} role="alert">{error}</p> : null;
  const siteForm = (
    <form className={s.inline} onSubmit={openSite}>
      <input className={s.input} value={manual ?? ""} onChange={(e) => { setManual(e.target.value); setError(""); }}
        placeholder="my-site.vercel.app" aria-label="Your deployed site address" inputMode="url" />
      <button className="pill" type="submit">Continue</button>
    </form>
  );

  if (handedOff) {
    return (
      <Step step={2} title="Your site is deployed" accent="deployed" lead="Setup continues in your other tab. You can close this one.">
        <a className="pill" href={handedOff}>Continue here instead <ArrowRight size={16} /></a>
      </Step>
    );
  }

  if (!current) {
    return (
      <Step step={1} title="Setting up" lead="Checking your site…">
        {notice}
        {error && <button className={LINK} onClick={() => void load()}>Try again</button>}
      </Step>
    );
  }

  if (current.view === "deploy" && deploying) {
    return (
      <Step step={1} title="Waiting for your deployment" accent="deployment" lead="Finish deploying in the Vercel tab. Then press Visit there and follow the steps on your new site. This page moves on once this computer is connected.">
        <p className={`live ${s.waiting}`} role="status">
          <LoaderCircle className={s.spinner} size={22} aria-hidden="true" /> Waiting for this computer to connect…
        </p>
        {notice}
        {stuck ? (
          <>
            <button className="pill" onClick={startDeploy}>Open Vercel again <ExternalLink size={16} /></button>
            <p className={s.hint}>
              Vercel shows your site’s address next to its Visit button. Enter it here to continue:
            </p>
            {siteForm}
          </>
        ) : (
          <button className={LINK} onClick={() => setStuck(true)}>Page not moving on?</button>
        )}
        <button className={LINK} onClick={stopWaiting}>Back</button>
      </Step>
    );
  }

  if (current.view === "deploy") {
    return (
      <Step step={1} title="Deploy your own copy" accent="own copy" lead="Vercel copies this project to your GitHub and creates a free database. It takes about a minute.">
        <fieldset className={s.choices}>
          <legend className={s.label}>Database</legend>
          {STORAGE_PROVIDERS.map((provider) => (
            <label key={provider.id} className={s.choice}>
              <input type="radio" name="storage" value={provider.id} checked={storage === provider.id}
                onChange={() => setStorage(provider.id)} />
              <span className={s.choiceName}>{provider.name}</span>
              <span className={s.choiceNote}>{provider.free}</span>
            </label>
          ))}
        </fieldset>
        <button className="pill pill-filled" onClick={startDeploy} disabled={!here}>
          Deploy to Vercel <ExternalLink size={16} />
        </button>
        <p className={s.hint}>Used up a free plan already? Pick another, or connect a database you already have when Vercel asks.</p>
        {notice}
        {manual === null ? (
          <button className={LINK} onClick={() => setManual("")}>Already deployed? Enter your site address</button>
        ) : siteForm}
        <button className={LINK} onClick={() => { chooseLocalDashboard(); router.push("/"); }}>
          Visit dashboard on this computer
        </button>
      </Step>
    );
  }

  if (current.view === "reconnect" && !status!.cloud && status!.deployed) {
    const site = status!.deployed;
    const host = new URL(site).host;
    return (
      <Step step={2} title="Reconnect this computer" accent="Reconnect" lead={`Your site ${host} is already deployed. Open it, sign in, and run its connect command on this computer to upload usage again.`}>
        <a className="pill pill-filled" href={new URL("/setup", site).href}>Open {host} <ExternalLink size={16} /></a>
        <p className={s.hint}>On a site that already has usage, choose “Connect another computer” to get the command.</p>
        {notice}
        <button className={LINK} onClick={() => putAside(site)}>Deploy a new copy instead</button>
        <button className={LINK} onClick={() => { chooseLocalDashboard(); router.push("/"); }}>
          Visit dashboard on this computer
        </button>
      </Step>
    );
  }

  if (current.view === "storage") {
    return (
      <Step step={1} title="Connect your database" accent="database" lead="Add any one of these free databases to this project in Vercel, then redeploy.">
        <div className={s.providers}>
          {STORAGE_PROVIDERS.map((provider) => (
            <a key={provider.id} className="pill" href={marketplaceUrl(provider)} target="_blank" rel="noreferrer">
              {provider.name} <ExternalLink size={14} />
            </a>
          ))}
        </div>
        <p className={s.hint}>Choose the project you just deployed when Vercel asks where to connect it. Another Redis or Postgres host works too: set REDIS_URL or DATABASE_URL yourself.</p>
        {notice}
        <button className={LINK} onClick={() => void load()}>I’ve done it, check again</button>
      </Step>
    );
  }

  if (current.view === "sign-in") {
    return (
      <Step step={2} title="Sign in to continue" accent="Sign in" lead="Enter the dashboard password you saved when you set up this site.">
        <form className={s.inline} onSubmit={signIn}>
          <input className={s.input} type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Dashboard password" aria-label="Dashboard password" autoFocus />
          <button className="pill pill-filled" type="submit" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        {notice}
        <p className={s.hint}>Lost it? Delete the project in Vercel and deploy again.</p>
      </Step>
    );
  }

  if (current.view === "connect") {
    return (
      <Step step={2} title="Connect your computer" accent="computer" lead="Paste this command into a terminal on the computer you use for AI coding.">
        {connect ? (
          <>
            <pre className={s.code}><code>{installCommand(connect)}</code></pre>
            <button className="pill pill-filled" onClick={() => void copy("command", installCommand(connect))}>
              {copied === "command" ? <Check size={16} /> : <Copy size={16} />} {copied === "command" ? "Copied" : "Copy command"}
            </button>
            {connect.password && (
              <div className={s.secret}>
                <div>
                  <span className={s.label}>Password (save it)</span>
                  <code className={s.secretValue}>{connect.password}</code>
                  <span className={s.hint}>Needed to sign in after today or on another device. Shown only once.</span>
                </div>
                <button className="pill" onClick={() => void copy("password", connect.password!)}>
                  {copied === "password" ? "Copied" : "Copy"}
                </button>
              </div>
            )}
            {notice}
            {hasData ? (
              <button className={LINK} onClick={() => { setConnecting(false); setConnect(null); }}>Done, continue to step 3</button>
            ) : (
              <p className={`live ${s.waiting}`} role="status"><span className={s.pulse} aria-hidden="true" /> Waiting for your first upload… This page moves on by itself.</p>
            )}
            <p className={s.hint}>macOS or Linux, with Node.js 24 and git. Only usage totals are uploaded. The code expires in 15 minutes.{" "}
              <button className={LINK} onClick={() => void getCommand()} disabled={busy}>New code</button></p>
            {/* People who began on their own computer's setup page left it waiting in another tab.
                It moves on by itself once this command links that computer, whatever this site is called. */}
            {status?.cloud && (
              <p className={s.hint}>Started setup on your computer? Once the command finishes, switch back to that setup tab. It moves on by itself.</p>
            )}
          </>
        ) : (
          <>
            <button className="pill pill-filled" onClick={() => void getCommand()} disabled={busy}>
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
    <Step step={3} title="Put it on your profile" accent="profile" lead="Preview your README with your real numbers, then publish it to GitHub.">
      <Link className="pill pill-filled" href="/edit">Open README editor <ArrowRight size={16} /></Link>
      {notice}
      <p className={s.hint}>
        {status?.cloud ? (
          <>
            <button className={LINK} onClick={() => { setConnecting(true); setConnect(null); }}>Connect another computer</button>
            {" · "}
            <Link className={LINK} href="/all">Open dashboard</Link>
          </>
        ) : status?.site ? (
          // The dashboard is only viewed on the deployed site.
          <a className={LINK} href={`${status.site}/all`}>Open your dashboard ↗</a>
        ) : null}
      </p>
    </Step>
  );
}
