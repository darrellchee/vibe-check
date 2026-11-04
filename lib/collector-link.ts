import { execFile } from "node:child_process";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv, promisify } from "node:util";
import { serviceFile, serviceLabel, serviceMarker } from "../scripts/collector-service-config";
import { linkedSite } from "./setup-flow";

// A local copy is "linked" when this computer uploads to a deployed site. The connect command
// installs the collector in its own checkout (~/.vibe-check by default) and registers a login
// service for it, so the link is found through that service, not only this checkout's settings.
export type LocalLink = { site: string; root: string };
type Runner = (command: string, args: string[]) => Promise<unknown>;
type Where = { home?: string; platform?: NodeJS.Platform; env?: Record<string, string | undefined>; cwd?: string; run?: Runner };

const exec = promisify(execFile);
const runCommand: Runner = (command, args) => exec(command, args, { timeout: 15_000 });
const LINK_KEYS = /^\s*(?:export\s+)?(SYNC_URL|SYNC_TOKEN)\s*=/;

const unxml = (value: string) =>
  value.replace(/&(lt|gt|amp|quot|apos);/g, (_, c: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[c]!);
const unsystemd = (value: string) => value.replace(/\\(["\\])/g, "$1").replace(/%%/g, "%");

// The checkout a service definition written by our installer runs from, or null for anything else.
export function serviceRoot(content: string): string | null {
  if (!content.includes(serviceMarker)) return null;
  const plist = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(content);
  if (plist) return unxml(plist[1]);
  const unit = /^WorkingDirectory="((?:[^"\\]|\\.)*)"$/m.exec(content);
  return unit ? unsystemd(unit[1]) : null;
}

// Removes the link settings from an env file's text and keeps every other line as it was.
export const withoutLink = (text: string) =>
  text.split("\n").filter((line) => !LINK_KEYS.test(line)).join("\n");

const platformOf = (where: Where) => {
  const platform = where.platform ?? process.platform;
  return platform === "darwin" || platform === "linux" ? platform : null;
};

async function readText(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function installedRoot(where: Where) {
  const platform = platformOf(where);
  if (!platform) return null;
  const content = await readText(serviceFile(platform, where.home ?? homedir()));
  return content ? serviceRoot(content) : null;
}

export async function readLocalLink(where: Where = {}): Promise<LocalLink | null> {
  const env = where.env ?? process.env;
  const own = linkedSite(env.SYNC_URL);
  if (own) return { site: own, root: where.cwd ?? process.cwd() };
  const root = await installedRoot(where);
  if (!root) return null;
  const text = await readText(path.join(root, ".env.local"));
  const site = text ? linkedSite(parseEnv(text).SYNC_URL) : null;
  return site ? { site, root } : null;
}

// The deployed site this copy belongs to, even when this computer no longer uploads to it: the
// linked site if there is one, else the address kept by an unlink or a finished deploy.
const KNOWN_KEY = /^\s*(?:export\s+)?DEPLOYED_SITE\s*=/;
export async function readKnownSite(where: Where = {}): Promise<string | null> {
  const link = await readLocalLink(where);
  if (link) return link.site;
  const env = where.env ?? process.env;
  const fromEnv = linkedSite(env.DEPLOYED_SITE);
  if (fromEnv) return fromEnv;
  const text = await readText(path.join(where.cwd ?? process.cwd(), ".env.local"));
  return text ? linkedSite(parseEnv(text).DEPLOYED_SITE) : null;
}

// Keeps the deployed site's address (not a secret) in this checkout's settings. It never links
// this computer: uploading still needs the connect command's SYNC_URL and SYNC_TOKEN.
export async function rememberSite(value: string, where: Where = {}) {
  const site = linkedSite(value);
  if (!site) return null;
  const file = path.join(where.cwd ?? process.cwd(), ".env.local");
  const lines = ((await readText(file)) ?? "").split("\n").filter((line) => !KNOWN_KEY.test(line));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  await writeFile(file, [...lines, `DEPLOYED_SITE=${site}`].join("\n") + "\n", { mode: 0o600 });
  await chmod(file, 0o600);
  (where.env ?? process.env).DEPLOYED_SITE = site;
  return site;
}

async function stripEnvFile(file: string) {
  const text = await readText(file);
  if (text === null || !text.split("\n").some((line) => LINK_KEYS.test(line))) return;
  await writeFile(file, withoutLink(text), { mode: 0o600 });
  await chmod(file, 0o600);
}

// Stops this computer uploading: removes the collector service, then the site and upload token
// from its settings. Usage already uploaded stays on the deployed site.
export async function unlinkLocal(where: Where = {}) {
  const platform = platformOf(where);
  const home = where.home ?? homedir();
  const cwd = where.cwd ?? process.cwd();
  const env = where.env ?? process.env;
  const root = await installedRoot(where);
  const run = where.run ?? runCommand;
  const link = await readLocalLink(where);
  if (platform && root) {
    const file = serviceFile(platform, home);
    if (platform === "darwin") {
      const domain = `gui/${process.getuid?.() ?? 0}/${serviceLabel}`;
      await run("launchctl", ["bootout", domain]).catch(() => undefined); // Not running is fine.
      await rm(file, { force: true });
    } else {
      await run("systemctl", ["--user", "disable", "--now", `${serviceLabel}.service`]).catch(() => undefined);
      await rm(file, { force: true });
      await run("systemctl", ["--user", "daemon-reload"]).catch(() => undefined);
    }
  }
  for (const dir of new Set([root, cwd].filter((d): d is string => Boolean(d))))
    await stripEnvFile(path.join(dir, ".env.local"));
  delete env.SYNC_URL;
  delete env.SYNC_TOKEN;
  // The site still exists, so setup offers to reconnect to it rather than deploy a second copy.
  if (link) await rememberSite(link.site, where);
}
