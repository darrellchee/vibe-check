import type { SetupState } from "./instance";

// The setup wizard has three steps. Which one to show is decided entirely by what the server and
// the browser already know, so a reload or a returning visitor always lands on the right page.
export type SetupStep =
  | { step: 1; view: "deploy" | "storage" }
  | { step: 2; view: "connect" | "sign-in" | "reconnect" }
  | { step: 3; view: "publish" };

export const SETUP_STEPS = 3;

export function setupStep(
  status: SetupState,
  { signedIn, hasData, connecting }: { signedIn: boolean; hasData: boolean; connecting: boolean },
): SetupStep {
  if (!status.cloud) {
    // A linked local copy has a deployed site and a collector already, so only publishing is left.
    if (status.site) return { step: 3, view: "publish" };
    // Not linked, but a site was deployed (kept by an unlink or a finished deploy): offer to
    // reconnect this computer to it rather than deploy a second copy.
    return status.deployed ? { step: 2, view: "reconnect" } : { step: 1, view: "deploy" };
  }
  if (status.storage !== "ok") return { step: 1, view: "storage" };
  if (!status.claimed) return { step: 2, view: "connect" };
  if (!signedIn) return { step: 2, view: "sign-in" };
  // "Connect another computer" from the last step keeps the connect page open on purpose.
  if (hasData && !connecting) return { step: 3, view: "publish" };
  return { step: 2, view: "connect" };
}

// The connect command writes SYNC_URL (the deployed site) into a local copy's .env.local. Only a
// public HTTPS origin counts as linked; a loopback test server does not.
export function linkedSite(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// What a dashboard page shows on this copy. A deployed copy always shows the dashboard. A local copy
// first shows a page pointing to the deployed site (or setup, when not linked yet); choosing
// "Visit dashboard" there sets a browser-session cookie, after which the local dashboard shows.
export const LOCAL_DASHBOARD_COOKIE = "vibe_check_local_dashboard";
export type GateView = "dashboard" | "deployed-only" | "setup";
export function gateView({ cloud, linked, chosen }: { cloud: boolean; linked: boolean; chosen: boolean }): GateView {
  if (cloud || chosen) return "dashboard";
  return linked ? "deployed-only" : "setup";
}

// Vercel's deploy button sends the user back with `deployment-url` (usually a bare host such as
// `vibe-check-abc.vercel.app`). Only Vercel's own domains are followed, so this can never be used
// to bounce visitors to an arbitrary site.
export function deployRedirectTarget(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/.test(host)) return null;
  return `https://${host}/setup`;
}

// Vercel does not always send the user back after deploying (it stays on its success page), so the
// waiting tab also finds the new site itself. Each deploy gets its own project name, which Vercel
// serves at <name>.vercel.app, and the tab checks that address until the new site answers.
const PROJECT_PATTERN = /^vibe-check-[a-z0-9]{8}$/;
export function newProjectName(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(8))) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return `vibe-check-${Array.from(bytes.slice(0, 8), (b) => alphabet[b % alphabet.length]).join("")}`;
}
export function expectedSite(project: string | null | undefined): string | null {
  return project && PROJECT_PATTERN.test(project) ? `https://${project}.vercel.app` : null;
}
// The new site is up once its setup status answers as a deployed copy.
export function isDeployedStatus(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && (body as { cloud?: unknown }).cloud === true);
}

// The deploy button opens Vercel in its own tab while the setup tab waits. When Vercel sends the
// user back, that tab tells the waiting tab (same origin, so a BroadcastChannel reaches it), which
// then moves on to the new site's setup. If no tab answers, the returning tab moves on itself.
export const DEPLOY_CHANNEL = "vibe-check-setup";
export const DEPLOY_PENDING_KEY = "vibe-check:deploy-pending";
export type DeployMessage = { type: "deployed"; target: string } | { type: "taken" };

// Messages from other tabs are checked like any other input: only a vercel.app setup page counts.
export function readDeployMessage(data: unknown): DeployMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.type === "taken") return { type: "taken" };
  if (message.type !== "deployed" || typeof message.target !== "string") return null;
  const target = deployRedirectTarget(message.target);
  return target ? { type: "deployed", target } : null;
}
