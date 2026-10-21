import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { collectionOptions } from "./options";
import { collectorService, serviceLabel, serviceMarker } from "./collector-service-config";

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (!["install", "uninstall", "status"].includes(action) || (action !== "install" && args.length))
    throw new Error("Use collector:install [--provider codex|claude|all], collector:status, or collector:uninstall.");
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("Automatic installation supports macOS and Linux. On Windows, run npm run sync -- --provider all --watch in a supervised terminal.");
  const { providers } = collectionOptions(args);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const service = collectorService({
    platform: process.platform,
    root,
    home: homedir(),
    node: process.execPath,
    loader: pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
    provider: providers.length > 1 ? "all" : providers[0],
  });
  const mac = process.platform === "darwin";
  const domain = `gui/${process.getuid!()}`;
  const unit = `${serviceLabel}.service`;
  const run = (command: string, values: string[]) => execFileSync(command, values, { stdio: "inherit" });
  if (action === "status") {
    const result = spawnSync(mac ? "launchctl" : "systemctl", mac ? ["print", `${domain}/${serviceLabel}`] : ["--user", "status", unit], { stdio: "inherit" });
    if (result.error) throw new Error("Service manager is unavailable in this session.");
    process.exitCode = result.status || 0;
    return;
  }
  let existing: string | null = null;
  try { existing = await readFile(service.file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing && !existing.includes(serviceMarker))
    throw new Error("A different service already uses this name. It was left unchanged.");
  if (action === "uninstall") {
    if (!existing) { console.log("Collector is not installed."); return; }
    if (mac) {
      if (spawnSync("launchctl", ["print", `${domain}/${serviceLabel}`], { stdio: "ignore" }).status === 0)
        run("launchctl", ["bootout", `${domain}/${serviceLabel}`]);
    } else run("systemctl", ["--user", "disable", "--now", unit]);
    await rm(service.file);
    if (!mac) run("systemctl", ["--user", "daemon-reload"]);
    console.log("Collector removed. Local settings and uploaded stats were kept.");
    return;
  }
  const envFile = path.join(root, ".env.local");
  let settings: Record<string, string | undefined>;
  try { settings = parseEnv(await readFile(envFile, "utf8")); }
  catch { throw new Error("Create .env.local in the repository with SYNC_URL and SYNC_TOKEN before installing."); }
  let url: URL;
  try { url = new URL(settings.SYNC_URL || ""); }
  catch { throw new Error("Set SYNC_URL in .env.local to your public HTTPS dashboard origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("SYNC_URL in .env.local must be a public HTTPS origin without credentials or a path.");
  if (!settings.SYNC_TOKEN || settings.SYNC_TOKEN.length < 32)
    throw new Error("Set SYNC_TOKEN in .env.local to a random secret of at least 32 characters.");
  await chmod(envFile, 0o600);
  await mkdir(path.dirname(service.file), { recursive: true });
  if (service.logDir) {
    await mkdir(service.logDir, { recursive: true, mode: 0o700 });
    for (const name of ["sync.log", "sync-error.log"]) {
      const log = path.join(service.logDir, name);
      await writeFile(log, "", { flag: "a", mode: 0o600 });
      await chmod(log, 0o600);
    }
  }
  await writeFile(service.file, service.content, { mode: 0o600 });
  await chmod(service.file, 0o600);
  if (mac) {
    if (spawnSync("launchctl", ["print", `${domain}/${serviceLabel}`], { stdio: "ignore" }).status === 0)
      run("launchctl", ["bootout", `${domain}/${serviceLabel}`]);
    run("launchctl", ["enable", `${domain}/${serviceLabel}`]);
    run("launchctl", ["bootstrap", domain, service.file]);
  } else {
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", unit]);
    // Reinstalling must apply changed arguments to an already-running service.
    run("systemctl", ["--user", "restart", unit]);
  }
  console.log("Collector installed. Starts at login and retries after a crash. Run npm run collector:status to check it.");
  console.log(mac ? `Logs: ${service.logDir}` : `Logs: journalctl --user -u ${unit}`);
}
main().catch((error) => {
  // Never dump child-process error objects or environment file contents.
  console.error(error instanceof Error && !error.message.startsWith("Command failed") ? error.message : "Service manager rejected the operation. Check its output above, then run collector:status.");
  process.exitCode = 1;
});
