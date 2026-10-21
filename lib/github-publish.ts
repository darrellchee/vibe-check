import { spawn } from "node:child_process";
import { LOGIN_PATTERN, PROFILE_DESCRIPTION } from "./github-web";

// One-click publishing through the GitHub CLI the owner is already signed in with. The app never sees,
// stores or asks for a token: it only hands `gh` fixed arguments. The target is always the signed-in
// user's own `<login>/<login>` repository, and the login comes from GitHub, never from the browser.
export type Gh = (args: string[], input?: string) => Promise<string>;
export type GhFailure = "missing" | "signed-out" | "not-found" | "failed";

export class GhError extends Error {
  constructor(message: string, readonly kind: GhFailure) { super(message); }
}

const TIMEOUT_MS = 20_000, MAX_OUTPUT = 2_000_000;

export const runGh: Gh = (args, input = "") => new Promise((resolve, reject) => {
  const child = spawn("gh", args, {
    env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: TIMEOUT_MS,
  });
  let out = "", err = "";
  child.stdout.on("data", (chunk) => { if (out.length < MAX_OUTPUT) out += chunk; });
  child.stderr.on("data", (chunk) => { if (err.length < MAX_OUTPUT) err += chunk; });
  child.on("error", (error) => reject(new GhError(
    (error as NodeJS.ErrnoException).code === "ENOENT" ? "The GitHub CLI (gh) is not installed." : "Could not run the GitHub CLI.",
    (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "failed")));
  child.on("close", (code, signal) => {
    if (code === 0) return resolve(out);
    const line = err.trim().split("\n")[0]?.slice(0, 200) || "";
    if (signal) reject(new GhError("GitHub took too long to answer.", "failed"));
    else if (code === 4 || /gh auth login|not logged in/i.test(err)) reject(new GhError("The GitHub CLI is not signed in.", "signed-out"));
    else if (/HTTP 404/.test(err)) reject(new GhError("Not found on GitHub.", "not-found"));
    else reject(new GhError(line ? `GitHub said: ${line}` : "GitHub rejected the request.", "failed"));
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(input);
});

// The route calls through this holder so tests can swap in a fake CLI. Production always uses `gh`.
export const gh: { run: Gh } = { run: runGh };

export type Profile = {
  login: string;
  repository: boolean;
  readme: { path: string; sha: string; content: string } | null;
};
export type Availability =
  | { available: false; reason: "cloud" | "missing" | "signed-out" }
  | { available: true; login: string; repository: boolean; readme: boolean };

export async function readProfile(gh: Gh): Promise<Profile> {
  const login = (await gh(["api", "user", "--jq", ".login"])).trim();
  if (!LOGIN_PATTERN.test(login)) throw new GhError("GitHub returned an unexpected username.", "failed");
  try {
    const found = JSON.parse(await gh(["api", `repos/${login}/${login}/readme`]));
    const path = typeof found.path === "string" && /^[\w. -]{1,100}$/.test(found.path) ? found.path : "README.md";
    return {
      login, repository: true,
      readme: { path, sha: String(found.sha), content: Buffer.from(String(found.content ?? ""), "base64").toString("utf8") },
    };
  } catch (error) {
    if (!(error instanceof GhError) || error.kind !== "not-found") throw error;
  }
  try {
    await gh(["api", `repos/${login}/${login}`, "--silent"]);
    return { login, repository: true, readme: null };
  } catch (error) {
    if (error instanceof GhError && error.kind === "not-found") return { login, repository: false, readme: null };
    throw error;
  }
}

export async function availability(gh: Gh): Promise<Availability> {
  try {
    const profile = await readProfile(gh);
    return { available: true, login: profile.login, repository: profile.repository, readme: profile.readme !== null };
  } catch (error) {
    if (error instanceof GhError && (error.kind === "missing" || error.kind === "signed-out"))
      return { available: false, reason: error.kind };
    throw error;
  }
}

export type Published = { login: string; status: "created" | "added" | "updated" | "unchanged" };

// Creates the profile repository when it is missing, then commits README.md. A README that already
// has the same content is left alone; a different one is replaced, and its old version stays in history.
export async function publishReadme(gh: Gh, markdown: string, { retryDelayMs = 800 } = {}): Promise<Published> {
  const profile = await readProfile(gh);
  const { login, readme } = profile;
  if (readme && readme.content === markdown) return { login, status: "unchanged" };
  if (!profile.repository)
    await gh(["api", "-X", "POST", "user/repos", "--input", "-"], JSON.stringify({ name: login, description: PROFILE_DESCRIPTION, private: false }));
  const path = (readme?.path ?? "README.md").split("/").map(encodeURIComponent).join("/");
  const body = JSON.stringify({
    message: readme ? "Update profile README" : "Add profile README",
    content: Buffer.from(markdown, "utf8").toString("base64"),
    ...(readme ? { sha: readme.sha } : {}),
  });
  // A repository created a moment ago can briefly answer 404 to its first commit.
  for (let attempt = 0; ; attempt++) {
    try {
      await gh(["api", "-X", "PUT", `repos/${login}/${login}/contents/${path}`, "--input", "-"], body);
      break;
    } catch (error) {
      if (profile.repository || attempt >= 2 || !(error instanceof GhError) || error.kind !== "not-found") throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return { login, status: !profile.repository ? "created" : readme ? "updated" : "added" };
}
