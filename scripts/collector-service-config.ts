import path from "node:path";

export const serviceLabel = "dev.codex-atlas.collector";
export const serviceMarker = "Managed by Codex Atlas collector installer";
type ServiceConfig = {
  platform: "darwin" | "linux";
  root: string;
  home: string;
  node: string;
  loader: string;
  provider: string;
};
const xml = (value: string) => value.replace(/[<>&"']/g, (c) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
);
// systemd performs percent expansion even inside quoted arguments.
const unitValue = (value: string, command = false) => {
  const escaped = value.replace(/%/g, "%%").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return '"' + (command ? escaped.replace(/\$/g, () => "$$") : escaped) + '"';
};

export function collectorService(config: ServiceConfig) {
  for (const value of Object.values(config)) {
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error("Service settings cannot contain control characters.");
  }
  const { platform, root, home, node, loader, provider } = config;
  if (!["codex", "claude", "cursor", "antigravity", "all"].includes(provider)) throw new Error("Unknown collector provider.");
  const args = [node, "--import", loader, path.join(root, "scripts/sync.ts"), "--provider", provider, "--watch"];
  if (platform === "darwin") {
    const logDir = path.join(home, "Library/Logs/CodexAtlas");
    return {
      file: path.join(home, "Library/LaunchAgents", `${serviceLabel}.plist`),
      logDir,
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${serviceLabel}</string>
<key>Comment</key><string>${serviceMarker}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path.dirname(node))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(path.join(logDir, "sync.log"))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logDir, "sync-error.log"))}</string>
</dict></plist>
`,
    };
  }
  return {
    file: path.join(home, ".config/systemd/user", `${serviceLabel}.service`),
    logDir: null,
    content: `# ${serviceMarker}
[Unit]
Description=Codex Atlas usage collector
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${unitValue(root)}
ExecStart=${args.map((arg) => unitValue(arg, true)).join(" ")}
Environment=${unitValue(`PATH=${path.dirname(node)}:/usr/local/bin:/usr/bin:/bin`)}
Restart=always
RestartSec=30
UMask=0077

[Install]
WantedBy=default.target
`,
  };
}
