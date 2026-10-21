// Plain POSIX sh, generated per deployment. It deliberately avoids ${...} and backticks so
// the template stays a plain string; __SITE__ and __REPO__ are validated before substitution.
const template = String.raw`#!/bin/sh
# Vibe Check collector installer. Read it first: curl -fsSL __SITE__/api/install
set -e
SITE='__SITE__'
REPO='__REPO__'
if [ $# -ne 1 ]; then
  echo "Usage: curl -fsSL $SITE/api/install | sh -s -- <connect-code>" >&2
  exit 1
fi
CODE=$1
case "$CODE" in
  *[!a-f0-9]*) echo "That connect code looks wrong. Copy the full command from $SITE/setup." >&2; exit 1 ;;
esac
if [ "$(printf %s "$CODE" | wc -c | tr -d ' ')" -ne 24 ]; then
  echo "That connect code looks wrong. Copy the full command from $SITE/setup." >&2
  exit 1
fi
case "$(uname -s)" in
  Darwin|Linux) ;;
  *) echo "Automatic install supports macOS and Linux. On Windows, clone $REPO and run: npm run sync -- --provider all --watch" >&2; exit 1 ;;
esac
need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. $2" >&2; exit 1; }
}
need git "Install it from https://git-scm.com/downloads"
need node "Install Node.js 24 or newer from https://nodejs.org"
need npm "Install Node.js 24 or newer from https://nodejs.org"
if [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 24 ]; then
  echo "Node.js 24 or newer is required. Found $(node -v)." >&2
  exit 1
fi
DIR=$VIBE_CHECK_DIR
[ -n "$DIR" ] || DIR=$HOME/.vibe-check
echo "Installing the collector into $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only --quiet
else
  git clone --depth 1 --quiet "$REPO" "$DIR"
fi
cd "$DIR"
npm ci --silent --no-audit --no-fund
echo "Connecting to $SITE"
RESPONSE=$(curl -fsS -X POST "$SITE/api/pair" -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}") || {
  echo "That connect code is invalid or expired. Open $SITE/setup for a new one." >&2
  exit 1
}
TOKEN=$(printf %s "$RESPONSE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).token;if(!/^[a-f0-9]{64}$/.test(t))throw 0;process.stdout.write(t)}catch{process.exit(1)}})') || {
  echo "Unexpected response while connecting. Open $SITE/setup for a new code." >&2
  exit 1
}
SITE="$SITE" TOKEN="$TOKEN" node -e '
const fs=require("fs");
const keep=(fs.existsSync(".env.local")?fs.readFileSync(".env.local","utf8").split("\n"):[]).filter(l=>l&&!/^(ATLAS_MODE|SYNC_URL|SYNC_TOKEN)=/.test(l));
keep.push("ATLAS_MODE=local","SYNC_URL="+process.env.SITE,"SYNC_TOKEN="+process.env.TOKEN);
fs.writeFileSync(".env.local",keep.join("\n")+"\n",{mode:0o600});
fs.chmodSync(".env.local",0o600);
'
npm run collector:install --silent -- --provider all
echo
echo "Done. Your usage now syncs automatically while this computer is on."
echo "Dashboard:  $SITE"
echo "Next step:  open $SITE/share to copy the Markdown for your GitHub profile README."
`;

const SITE_PATTERN = /^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i;
const REPO_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/;

export function installScript(site: string, repo: string) {
  if (!SITE_PATTERN.test(site)) throw new Error("Unsupported site origin.");
  if (!REPO_PATTERN.test(repo)) throw new Error("Unsupported repository.");
  return template.replaceAll("__SITE__", site).replaceAll("__REPO__", repo);
}
