"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, KeyRound, Rocket, Terminal } from "lucide-react";
import { deploymentUrl, profileEmbed } from "@/lib/profile-card";
import { PROVIDERS, providerName } from "@/lib/providers";

type Status =
  | { cloud: false }
  | { cloud: true; storage: "missing" | "error" }
  | { cloud: true; storage: "ok"; claimed: boolean; managedByEnv: boolean };
type Connect = { code: string; origin: string; password?: string };

const installCommand = ({ origin, code }: Connect) =>
  `curl -fsSL ${origin}/api/install | sh -s -- ${code}`;

async function fetchState() {
  const [status, usage] = await Promise.all([
    fetch("/api/setup/status", { cache: "no-store" }).then((r) => r.json() as Promise<Status>),
    fetch("/api/usage", { cache: "no-store" }),
  ]);
  return { status, signedIn: usage.status !== 401 };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* Clipboard blocked: the text stays selectable above. */
        }
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
      {done ? "Copied" : label}
    </button>
  );
}

export default function Setup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [connect, setConnect] = useState<Connect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await fetchState();
      setStatus(next.status);
      setSignedIn(next.signedIn);
      setError("");
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
    }
  }, []);
  useEffect(() => {
    let live = true;
    fetchState()
      .then((next) => {
        if (!live) return;
        setStatus(next.status);
        setSignedIn(next.signedIn);
      })
      .catch(() => live && setError("Could not reach the server. Check your connection and retry."));
    return () => {
      live = false;
    };
  }, []);

  async function post(url: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error || "Something went wrong.");
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
  async function claim() {
    const body = await post("/api/setup/claim");
    if (body) {
      setConnect({ code: body.pairingCode, origin: body.origin, password: body.password });
      setSignedIn(true);
      setStatus({ cloud: true, storage: "ok", claimed: true, managedByEnv: false });
    }
  }
  async function newCode() {
    const body = await post("/api/setup/pair");
    if (body) setConnect({ code: body.pairingCode, origin: body.origin });
  }

  const readme = connect
    ? PROVIDERS.map((p) => profileEmbed(connect.origin, p, "dark", ["tokens", "sessions"]).markdown).join("\n")
    : "";

  return (
    <main className="profile-setup">
      <Link className="profile-back" href="/"><ArrowLeft size={15} /> Back to dashboard</Link>
      <header className="profile-heading">
        <div className="eyebrow"><Rocket size={16} /> SET UP</div>
        <h1>Two steps<span>.</span></h1>
        <p>Claim this dashboard, then run one command on the computer that has your usage history.</p>
      </header>
      {error && <p className="profile-error" role="alert">{error}</p>}
      {!status && !error && <p role="status">Checking your deployment…</p>}

      {status && !status.cloud && (
        <section className="panel profile-step">
          <h2>This copy isn’t deployed yet</h2>
          <p>Setup runs on your own deployment. Deploy once and Redis is created for you.</p>
          <a className="button primary" href={deploymentUrl()} target="_blank" rel="noreferrer">Deploy to Vercel ↗</a>
        </section>
      )}

      {status?.cloud && status.storage !== "ok" && (
        <section className="panel profile-step">
          <h2>Connect Redis storage</h2>
          <p>
            {status.storage === "missing"
              ? "This project has no Redis database yet. In Vercel open your project → Storage → Create → Upstash for Redis (free plan), connect it to this project, then redeploy."
              : "The Redis database didn’t respond. Check it in Vercel → Storage, then retry."}
          </p>
          <button className="button" onClick={() => void load()}>Check again</button>
        </section>
      )}

      {status?.cloud && status.storage === "ok" && !status.claimed && (
        <section className="panel profile-step">
          <span className="profile-step-number">01 / CLAIM</span>
          <h2>Claim this dashboard</h2>
          <p>
            The first person to claim it owns it, so do this now. We generate a strong password for you and keep only a hash of it.
          </p>
          <button className="button primary" disabled={busy} onClick={() => void claim()}>
            <KeyRound size={15} /> {busy ? "Claiming…" : "Claim this dashboard"}
          </button>
        </section>
      )}

      {status?.cloud && status.storage === "ok" && status.claimed && !signedIn && !connect && (
        <section className="panel profile-step">
          <h2>Already claimed</h2>
          <p>Sign in to connect a computer or manage your cards. If you didn’t claim this site, redeploy it from a fresh Vercel project.</p>
          <Link className="button primary" href="/">Sign in</Link>
        </section>
      )}

      {status?.cloud && status.storage === "ok" && status.claimed && signedIn && !connect && (
        <section className="panel profile-step">
          <span className="profile-step-number">02 / CONNECT</span>
          <h2>Connect a computer</h2>
          <p>Generate a one-time command for the computer that holds your Codex, Claude Code or Cursor history.</p>
          <button className="button primary" disabled={busy} onClick={() => void newCode()}>
            <Terminal size={15} /> {busy ? "Generating…" : "Get connect command"}
          </button>
        </section>
      )}

      {connect && (
        <>
          {connect.password && (
            <section className="panel profile-step">
              <span className="profile-step-number">SAVED · SHOWN ONCE</span>
              <h2>Your dashboard password</h2>
              <p>You’re already signed in on this browser. Save this password to sign in elsewhere. It can’t be shown again.</p>
              <pre><code>{connect.password}</code></pre>
              <CopyButton text={connect.password} label="Copy password" />
            </section>
          )}
          <section className="panel profile-step">
            <span className="profile-step-number">02 / CONNECT</span>
            <h2>Run this on your computer</h2>
            <p>Paste it into a terminal on macOS or Linux. It installs the collector, links it to this dashboard and starts it at login. The code works once and expires in 15 minutes.</p>
            <pre><code>{installCommand(connect)}</code></pre>
            <CopyButton text={installCommand(connect)} label="Copy command" />
            <p>Needs Node.js 24+ and git. Only usage totals are uploaded, never conversations or credentials. <button className="profile-origin" onClick={() => void newCode()}>Need a fresh code?</button></p>
          </section>
          <section className="panel profile-step">
            <span className="profile-step-number">03 / SHOW IT OFF</span>
            <h2>Add it to your GitHub profile</h2>
            <p>Your cards are public by default for every provider, and the same opt-in covers activity calendars: anyone with the link can see summary totals and which days were active. Paste the lines you want into your profile README.</p>
            <pre><code>{readme}</code></pre>
            <CopyButton text={readme} label="Copy Markdown" />
            <p>Pick a theme and metrics on <Link href="/share">the card designer</Link>. {PROVIDERS.map(providerName).join(", ")} cards appear once their first sync lands.</p>
          </section>
        </>
      )}
    </main>
  );
}
