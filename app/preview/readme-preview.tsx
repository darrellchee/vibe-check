"use client";
/* eslint-disable @next/next/no-img-element -- the avatar is the owner's GitHub picture, shown as-is */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Download, ExternalLink, RefreshCw, Upload, X } from "lucide-react";
import { TopNav } from "@/components/vibe-check-chrome";
import { providerName } from "@/lib/providers";
import { cardFix, disabledReason, siteWideMessage, type DisabledReason } from "@/lib/card-diagnosis";
import { probeProfile, webPublish, type RepoProbe } from "@/lib/github-web";
import { rowRanges, serializeReadme, widthOf } from "@/lib/readme-doc";
import type { CardProvider } from "@/lib/types";
import { cardKind, Markdown, PreviewBoundary, useDraft, useUsage, useViewerScheme, validLogin, WidgetPreview, type WidgetBlock } from "../_readme/shared";
import s from "../_github-frame/profile.module.css";
import p from "./preview.module.css";

type ProbeIssue = "disabled" | "pending";
// "on": this computer's GitHub CLI can publish for the owner with one click. "off": the panel links to
// GitHub's own page instead (a deployed copy, or no signed-in CLI).
type Cli = { status: "checking" } | { status: "off"; reason: string } | { status: "on"; login: string; repository: boolean; readme: boolean };
type Published = { login: string; status: "created" | "added" | "updated" | "unchanged" };
const PUBLISHED_TEXT: Record<Published["status"], string> = {
  created: "Created your profile repository and published your README.",
  added: "Published your README.",
  updated: "Updated your README.",
  unchanged: "Your profile README is already up to date.",
};
const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled), textarea, summary, [tabindex]:not([tabindex='-1'])";

export default function ReadmePreview({ fontClass }: { fontClass: string }) {
  const { blocks, origin, setOrigin, login, setLogin, ready, localCopy } = useDraft();
  const usage = useUsage();
  const { snapshotOf, statusOf, errorOf, loaded, harnesses } = usage;
  // GitHub follows the system theme unless told otherwise, so the preview starts there too.
  const systemScheme = useViewerScheme();
  const [picked, setTheme] = useState<"dark" | "light" | null>(null);
  const theme = picked ?? systemScheme;
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  // Probe results, tagged with the origin they came from so results for an old address are ignored.
  const [probe, setProbe] = useState<{ origin: string; issues: Record<string, ProbeIssue>; reason: DisabledReason }>({ origin: "", issues: {}, reason: "unknown" });
  const [cli, setCli] = useState<Cli>({ status: "checking" });
  const [web, setWeb] = useState<{ login: string; probe: RepoProbe } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<Published | null>(null);
  const [publishError, setPublishError] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const publishRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const username = validLogin(login);
  const announce = useCallback((text: string) => setAnnouncement((prev) => (prev === text ? `${text} ` : text)), []);
  const ranges = useMemo(() => rowRanges(blocks), [blocks]);
  const output = useMemo(() => serializeReadme(blocks, origin), [blocks, origin]);
  const hasWidgets = blocks.some((b) => b.type !== "text");
  const publishable = Boolean(output.markdown) && !output.originError;
  const originInvalid = Boolean(origin && output.originError);
  const edited = () => { setCopied(false); setMessage(""); setPublished(null); setPublishError(""); };

  // Ask the server whether this computer's GitHub CLI can publish. If so, its account is the one
  // that gets the README, so it also fills in the username.
  useEffect(() => {
    if (!ready) return;
    let ignore = false;
    fetch("/api/publish", { cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() : { available: false, reason: "unreachable" }))
      .catch(() => ({ available: false, reason: "unreachable" }))
      .then((result) => {
        if (ignore) return;
        if (result?.available && validLogin(result.login)) {
          setCli({ status: "on", login: result.login, repository: Boolean(result.repository), readme: Boolean(result.readme) });
          setLogin(result.login);
        } else setCli({ status: "off", reason: String(result?.reason ?? "unreachable") });
      });
    return () => { ignore = true; };
  }, [ready, setLogin]);

  // Without the CLI, look at the profile repository on GitHub so the button can go straight to the right
  // page. Looked up again when the tab regains focus, e.g. after creating the repository.
  const cliOff = cli.status === "off";
  useEffect(() => {
    if (!cliOff || !username) return;
    const controller = new AbortController();
    const look = () => void probeProfile(username, controller.signal).then((found) => {
      if (!controller.signal.aborted) setWeb({ login: username, probe: found });
    });
    const timer = setTimeout(look, 400);
    window.addEventListener("focus", look);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("focus", look); };
  }, [cliOff, username]);

  // The public card endpoint is what GitHub will load, but previews come from private data and look
  // fine even when it would 404. Probe each (provider, kind) the README uses, without reading the SVG.
  // Probe the site the README points at, not this page's server: a local copy has no public cards.
  const pairKey = useMemo(() => [...new Set(blocks.flatMap((b) => (b.type === "text" ? [] : [`${b.provider}|${cardKind(b)}`])))].sort().join(","), [blocks]);
  const probeOrigin = output.originError ? "" : origin;
  useEffect(() => {
    if (!loaded || !pairKey || !probeOrigin) return;
    let ignore = false;
    void Promise.all(pairKey.split(",").map(async (pair): Promise<[string, ProbeIssue | null]> => {
      const [provider, kind] = pair.split("|");
      try {
        const url = new URL(`/api/card?provider=${provider}&kind=${kind}&theme=dark`, probeOrigin);
        const response = await fetch(url, { cache: "no-store" });
        void response.body?.cancel().catch(() => undefined);
        return [pair, response.status === 404 ? "disabled" : response.status === 503 ? "pending" : null];
      } catch { return [pair, null]; }
    })).then(async (results) => {
      const issues = Object.fromEntries(results.filter((r): r is [string, ProbeIssue] => r[1] !== null));
      // A disabled card has several possible causes; the site's public setup status says which.
      let reason: DisabledReason = "unknown";
      if (Object.values(issues).includes("disabled")) {
        try {
          const response = await fetch(new URL("/api/setup/status", probeOrigin), { cache: "no-store" });
          if (response.ok) reason = disabledReason(await response.json());
        } catch { /* An older site without CORS: fall back to the general advice. */ }
      }
      if (!ignore) setProbe({ origin: probeOrigin, issues, reason });
    });
    return () => { ignore = true; };
  }, [loaded, pairKey, harnesses, probeOrigin]);
  const cardWarnings = useMemo(() => {
    const issues = new Map<CardProvider, ProbeIssue>();
    for (const pair of pairKey ? pairKey.split(",") : []) {
      const issue = probe.origin === probeOrigin ? probe.issues[pair] : undefined;
      const provider = pair.split("|")[0] as CardProvider;
      if (issue && issues.get(provider) !== "disabled") issues.set(provider, issue);
    }
    return [...issues];
  }, [pairKey, probe, probeOrigin]);
  // When the whole site is the problem (no storage, not claimed), one notice replaces the per-card ones.
  const siteWide = cardWarnings.some(([, issue]) => issue === "disabled") ? siteWideMessage(probe.reason) : null;
  const notices = [
    ...output.warnings,
    ...(siteWide ? [siteWide] : []),
    ...cardWarnings.filter(([, issue]) => !(siteWide && issue === "disabled")).map(([provider, issue]) => issue === "disabled"
      ? `${provider === "all" ? "The public cards for every harness are disabled, so the All images" : `${providerName(provider)}’s public card is disabled, so its images`} will not load on GitHub. ${cardFix(probe.reason)}`
      : `No uploaded ${provider === "all" ? "usage" : `${providerName(provider)} snapshot`} yet, so ${provider === "all" ? "the All images" : "its images"} will not load on GitHub until the collector syncs.`),
  ];

  // The Publish panel is a modal: the page behind it stops scrolling, Escape closes it, Tab stays
  // inside it, and focus goes back to the Publish button afterwards.
  const close = useCallback(() => { setOpen(false); publishRef.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement, previous = root.style.overflow;
    root.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => { root.style.overflow = previous; };
  }, [open]);
  const onDrawerKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const items = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(output.markdown);
      const text = "README copied. Paste it into your profile repository.";
      setCopied(true); setMessage(text); announce(text);
    } catch {
      const text = "Clipboard unavailable. Select and copy the Markdown above.";
      setMessage(text); announce(text);
    }
  }
  async function publish() {
    setPublishing(true); setPublishError(""); setPublished(null);
    try {
      const response = await fetch("/api/publish", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: output.markdown }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Could not publish to GitHub.");
      setPublished(result);
      setCli((prev) => (prev.status === "on" ? { ...prev, repository: true, readme: true } : prev));
      announce(PUBLISHED_TEXT[result.status as Published["status"]] ?? "Published to GitHub.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not publish to GitHub.";
      setPublishError(text); announce(text);
    } finally { setPublishing(false); }
  }
  // Without the CLI the button is a plain link, so the copy for long READMEs happens in the click itself.
  const webPlan = cli.status === "off" && username && web?.login === username ? webPublish(username, web.probe, output.markdown) : null;
  function openWeb() {
    if (!webPlan?.copy) return;
    void navigator.clipboard.writeText(output.markdown).then(() => announce("README copied."), () => announce("Clipboard unavailable. Copy the Markdown below."));
  }
  function download() {
    const url = URL.createObjectURL(new Blob([output.markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "README.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const cliPlan = cli.status === "on" ? {
    label: publishing ? "Publishing…" : !cli.repository ? "Create repository & publish" : cli.readme ? "Update my profile README" : "Publish to my profile",
    note: !cli.repository ? `Creates the public repository ${cli.login}/${cli.login} and adds your README to it.`
      : cli.readme ? `Replaces the README in ${cli.login}/${cli.login}. The previous version stays in the repository’s history.`
        : `Adds README.md to ${cli.login}/${cli.login}.`,
  } : null;
  const cliHint = cli.status !== "off" ? "" : cli.reason === "signed-out"
    ? "Run gh auth login in a terminal to publish with a single click from this computer."
    : cli.reason === "missing" ? "Install the GitHub CLI (cli.github.com) and run gh auth login to publish with a single click from this computer." : "";

  const name = username || "username";
  return (
    <div className="shell">
      <TopNav selected="edit" home="/all" name="all" />
      <main>
        <div className={p.bar}>
          <div className={p.barLead}>
            <Link className="pill pill-sm" href="/edit" transitionTypes={["nav-back"]}><ArrowLeft size={14} aria-hidden />Edit</Link>
            <div>
              <p className="eyebrow">Preview</p>
              <p className={p.barText}>How <strong>github.com/{name}</strong> will look</p>
            </div>
          </div>
          <div className={p.barTools}>
            <div className="segmented" role="group" aria-label="GitHub theme">
              {(["dark", "light"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={theme === t} className={theme === t ? "selected" : ""} onClick={() => setTheme(t)}>
                  GitHub {t}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Screen size">
              {([false, true] as const).map((m) => (
                <button key={String(m)} type="button" aria-pressed={mobile === m} className={mobile === m ? "selected" : ""} onClick={() => setMobile(m)}>
                  {m ? "Mobile" : "Desktop"}
                </button>
              ))}
            </div>
            <button ref={publishRef} type="button" className="pill pill-filled" aria-haspopup="dialog" onClick={() => setOpen(true)}>
              <Upload size={16} aria-hidden />Publish
            </button>
          </div>
        </div>

        {notices.length > 0 && (
          <ul className={p.notices} aria-label="Before you publish">
            {notices.map((text, i) => <li key={i}><span className="tag">Heads up</span><span>{text}</span></li>)}
          </ul>
        )}

        <div className={p.stage}>
          <div className={`${s.root} ${s.interactive} ${fontClass} ${p.frame} ${theme === "light" ? p.light : ""} ${mobile ? p.mobile : ""}`}>
            {/* GitHub's header and profile tabs, drawn only for context: none of it is a working control. */}
            <div className={p.ghBar} aria-hidden="true">
              <span className={p.mark} />
              <span>{name}</span>
            </div>
            <div className={p.tabs} aria-hidden="true">
              <span className={`${p.tab} ${p.tabOn}`}>Overview</span>
              <span className={p.tab}>Repositories</span>
              <span className={p.tab}>Projects</span>
              <span className={p.tab}>Packages</span>
              <span className={p.tab}>Stars</span>
            </div>
            <div className={p.layout}>
              <div className={p.sidebar}>
                {username
                  ? <img className={p.avatar} src={`https://github.com/${username}.png?size=460`} alt="" referrerPolicy="no-referrer" />
                  : <div className={p.avatar} />}
                <div className={p.names}>
                  <span className={s.username}>{name}</span>
                  <span className={`${s.follow} ${p.follow}`} aria-hidden="true">Edit profile</span>
                </div>
              </div>
              <div className={p.content}>
                <div className={s.readme}>
                  <div className={s.readmeTitle}>{name}<span className={s.slash}>/</span>README<span className={s.muted}>.md</span></div>
                  <article className={p.rendered}>
                    <PreviewBoundary fallback={<div className={p.failed}><p>This preview could not be drawn. Your README is unchanged.</p><Link href="/edit">Back to Edit</Link></div>}>
                      {ready && blocks.length === 0
                        ? <p className={s.muted}>Nothing to preview yet. <Link href="/edit">Add some elements</Link>.</p>
                        : ranges.map((range) => {
                          const row = blocks.slice(range.start, range.end), first = row[0];
                          return first.type === "text"
                            ? <Markdown key={first.id} text={first.text} />
                            : <div key={first.id} className={p.figureRow}>
                              {(row as WidgetBlock[]).map((b) => (
                                <div key={b.id} className={p.sizer} style={{ width: widthOf(b) }}>
                                  <WidgetPreview block={b} snapshot={snapshotOf(b.provider)} status={statusOf(b.provider)} error={errorOf(b.provider)} scheme={theme} />
                                </div>
                              ))}
                            </div>;
                        })}
                    </PreviewBoundary>
                  </article>
                </div>
                <p className={p.note}>Close to GitHub, not exact: HTML, tables and nested lists are not drawn here.</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {open && (
        <div className={p.overlay}>
          <button type="button" className={p.scrim} tabIndex={-1} aria-label="Close" onClick={close} />
          <aside ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="publish-title" className={p.drawer} onKeyDown={onDrawerKey}>
            <div className={p.drawerHead}>
              <div>
                <p className="eyebrow">Publish</p>
                <h2 id="publish-title" className={`display-s ${p.drawerTitle}`}>Put it on <span className={p.accent}>GitHub</span></h2>
              </div>
              <button type="button" className="round round-sm" aria-label="Close" data-autofocus onClick={close}><X size={16} /></button>
            </div>

            <ol className={p.checks}>
              <li className={p.check}>
                <span className={`${p.dot} ${username ? p.dotOk : ""}`} aria-hidden="true">{username && <Check size={12} strokeWidth={3} />}</span>
                <div className={p.checkBody}>
                  <label htmlFor="readme-login" className={p.label}>GitHub username</label>
                  <input id="readme-login" className={p.field} type="text" placeholder="octocat" value={login} maxLength={39} autoComplete="off"
                    autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(login && !username)} aria-describedby="readme-login-help"
                    readOnly={cli.status === "on"} onChange={(ev) => { setLogin(ev.target.value.trim()); edited(); }} />
                  <p id="readme-login-help" className={p.help}>
                    {login && !username
                      ? "Use letters, numbers and hyphens only, starting with a letter or number, up to 39 characters."
                      : cli.status === "on" ? "Taken from the account your GitHub CLI is signed in to."
                        : "Used to publish. It is only stored in this browser."}
                    {username && <>{" "}<a href={`https://github.com/${username}/${username}`} target="_blank" rel="noreferrer noopener">Open your profile repository</a></>}
                  </p>
                </div>
              </li>
              <li className={p.check}>
                <span className={`${p.dot} ${!output.originError ? p.dotOk : ""}`} aria-hidden="true">{!output.originError && <Check size={12} strokeWidth={3} />}</span>
                <div className={p.checkBody}>
                  <label htmlFor="readme-origin" className={p.label}>Cards load from</label>
                  <input id="readme-origin" className={p.field} type="url" placeholder="https://your-instance.vercel.app" value={origin}
                    aria-invalid={originInvalid} aria-describedby={originInvalid ? "readme-origin-error readme-origin-help" : "readme-origin-help"}
                    onChange={(ev) => { setOrigin(ev.target.value); edited(); }} />
                  {!localCopy && <button type="button" className={`pill pill-sm ${p.fit}`} onClick={() => { setOrigin(window.location.origin); edited(); }}>Use this website’s address</button>}
                  {originInvalid && <p id="readme-origin-error" role="alert" className={`${p.help} ${p.error}`}>{output.originError}</p>}
                  <p id="readme-origin-help" className={p.help}>
                    {localCopy && output.originError
                      ? <>You’re on your local copy. Enter your deployed site’s address so GitHub can load the images, or <Link href="/setup">deploy one first</Link>.</>
                      : output.originError && !origin
                        ? "Cards are images GitHub loads from your dashboard, so enter its public HTTPS address."
                        : `A public HTTPS address.${hasWidgets ? " GitHub cannot load images from localhost." : ""}`}
                  </p>
                </div>
              </li>
              {notices.length > 0 && (
                <li className={p.check}>
                  <span className={`${p.dot} ${p.dotWarn}`} aria-hidden="true">!</span>
                  <div className={p.checkBody}>
                    <span className={p.label}>{notices.length === 1 ? "1 thing to check" : `${notices.length} things to check`}</span>
                    <ul className={p.warnList}>{notices.map((text, i) => <li key={i}>{text}</li>)}</ul>
                  </div>
                </li>
              )}
            </ol>

            <div className={p.action}>
              {cliPlan ? (
                <button type="button" className={`pill pill-filled ${p.wide}`} disabled={!publishable || publishing} onClick={() => void publish()}>
                  {publishing ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}{cliPlan.label}
                </button>
              ) : webPlan && publishable ? (
                <a className={`pill pill-filled ${p.wide}`} href={webPlan.href} target="_blank" rel="noreferrer noopener" onClick={openWeb}>
                  <ExternalLink size={16} />{webPlan.label}
                </a>
              ) : (
                <button type="button" className={`pill pill-filled ${p.wide}`} disabled>
                  <Upload size={16} />{cli.status === "checking" || (username && !web) ? "Checking GitHub…" : "Publish to GitHub"}
                </button>
              )}
              <p className={p.help}>
                {cliPlan ? cliPlan.note
                  : !username ? "Enter your GitHub username above and this becomes a one-click publish."
                    : webPlan && publishable ? webPlan.note : ""}
                {!cliPlan && cliHint && <>{" "}{cliHint}</>}
              </p>
              {publishError && <p role="alert" className={`${p.help} ${p.error}`}>{publishError}</p>}
              {published && (
                <p role="status" className={`${p.help} ${p.success}`}>
                  {PUBLISHED_TEXT[published.status]}{" "}
                  <a href={`https://github.com/${published.login}`} target="_blank" rel="noreferrer noopener">View your profile on GitHub</a>
                </p>
              )}
            </div>

            <details className={p.manual}>
              <summary>Prefer to publish it yourself?</summary>
              <label htmlFor="readme-markdown" className={p.label}>README.md</label>
              <textarea id="readme-markdown" className={p.output} readOnly rows={Math.min(12, Math.max(5, output.markdown.split("\n").length + 1))}
                value={output.markdown} placeholder="Add elements in the editor to generate the Markdown." />
              <div className={p.buttons}>
                <button type="button" className="pill pill-sm" disabled={!publishable} onClick={() => void copy()}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy Markdown"}
                </button>
                <button type="button" className="pill pill-sm" disabled={!publishable} onClick={download}><Download size={14} />Download README.md</button>
              </div>
              {message && <p className={p.help}>{message}</p>}
              <p className={p.help}>
                Create a public GitHub repository named exactly like your username, then paste this into its <code>README.md</code> (or
                replace the file with the download). GitHub caches images, so cards can lag behind your latest sync. Calendars publish per-day
                activity levels, and your dashboard stays password protected.
              </p>
            </details>
          </aside>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  );
}
