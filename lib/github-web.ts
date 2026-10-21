// Pure helpers for putting the README on GitHub without any credentials: GitHub's own web UI
// does the committing. Safe for the browser; the server-side CLI publisher lives in github-publish.ts.
export const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const PROFILE_DESCRIPTION = "My GitHub profile README";

// GitHub rejects very long URLs, so a larger README is copied to the clipboard instead of prefilled.
export const MAX_PREFILL_URL = 7000;

export type RepoProbe = { repo: "missing" | "empty" | "readme" | "unknown"; branch: string; path: string };
export type WebPublish = { href: string; label: string; copy: boolean; note: string };

const API = "https://api.github.com";
const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

// Asks GitHub's public API what the profile repository looks like. Anything unexpected (rate limit,
// offline) is "unknown" rather than an error, because the publish link still works without it.
export async function probeProfile(login: string, signal?: AbortSignal): Promise<RepoProbe> {
  const unknown: RepoProbe = { repo: "unknown", branch: "main", path: "README.md" };
  try {
    const repo = await fetch(`${API}/repos/${login}/${login}`, { headers, signal, cache: "no-store" });
    if (repo.status === 404) return { ...unknown, repo: "missing" };
    if (!repo.ok) return unknown;
    const branch = String((await repo.json())?.default_branch ?? "main");
    const readme = await fetch(`${API}/repos/${login}/${login}/readme`, { headers, signal, cache: "no-store" });
    if (readme.status === 404) return { repo: "empty", branch, path: "README.md" };
    if (!readme.ok) return { ...unknown, branch };
    const path = String((await readme.json())?.path ?? "README.md");
    return { repo: "readme", branch, path: /^[\w. -]{1,100}$/.test(path) ? path : "README.md" };
  } catch { return unknown; }
}

// Where the one click should take the user, given what exists. Always a plain link, so it is computed
// before the click and never blocked as a popup.
export function webPublish(login: string, probe: RepoProbe, markdown: string): WebPublish {
  const home = `https://github.com/${login}/${login}`;
  const branch = encodeURIComponent(probe.branch);
  if (probe.repo === "missing")
    return {
      href: `https://github.com/new?${new URLSearchParams({ name: login, description: PROFILE_DESCRIPTION, visibility: "public" })}`,
      label: "Create the repository on GitHub", copy: false,
      note: `Step 1 of 2: GitHub opens with ${login}/${login} filled in. Press Create repository, then come back here.`,
    };
  if (probe.repo === "empty") {
    const prefilled = `${home}/new/${branch}?${new URLSearchParams({ filename: "README.md", value: markdown })}`;
    const fits = prefilled.length <= MAX_PREFILL_URL;
    return {
      href: fits ? prefilled : `${home}/new/${branch}?filename=README.md`,
      label: "Publish on GitHub", copy: !fits,
      note: fits ? "GitHub opens with your README filled in. Press Commit changes." : "Your README is copied. Paste it into the editor GitHub opens, then press Commit changes.",
    };
  }
  if (probe.repo === "readme")
    return {
      href: `${home}/edit/${branch}/${probe.path.split("/").map(encodeURIComponent).join("/")}`,
      label: "Replace README on GitHub", copy: true,
      note: "Your README is copied. Select all in the editor GitHub opens, paste, then press Commit changes.",
    };
  return {
    href: home, label: "Open your profile repository", copy: true,
    note: "Your README is copied. Open README.md there, choose Edit, paste, then press Commit changes.",
  };
}
