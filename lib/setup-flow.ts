import type { SetupState } from "./instance";

// The setup wizard has three steps. Which one to show is decided entirely by what the server and
// the browser already know, so a reload or a returning visitor always lands on the right page.
export type SetupStep =
  | { step: 1; view: "deploy" | "storage" }
  | { step: 2; view: "connect" | "sign-in" }
  | { step: 3; view: "publish" };

export const SETUP_STEPS = 3;

export function setupStep(
  status: SetupState,
  { signedIn, hasData, connecting }: { signedIn: boolean; hasData: boolean; connecting: boolean },
): SetupStep {
  if (!status.cloud) return { step: 1, view: "deploy" };
  if (status.storage !== "ok") return { step: 1, view: "storage" };
  if (!status.claimed) return { step: 2, view: "connect" };
  if (!signedIn) return { step: 2, view: "sign-in" };
  // "Connect another computer" from the last step keeps the connect page open on purpose.
  if (hasData && !connecting) return { step: 3, view: "publish" };
  return { step: 2, view: "connect" };
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
