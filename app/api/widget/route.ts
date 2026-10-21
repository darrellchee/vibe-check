import { readSnapshot } from "@/lib/storage";
import { providerFromUrl } from "@/lib/providers";
import { cardsPublic } from "@/lib/instance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const compact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
export async function GET(request?: Request) {
  let provider;
  try {
    provider = providerFromUrl(request?.url || "http://localhost/api/widget");
  } catch {
    return new Response("Unknown usage provider.", { status: 400 });
  }
  if (!(await cardsPublic(provider)))
    return new Response("Public widget is disabled.", { status: 404 });
  try {
    const s = await readSnapshot(provider);
    if (!s) return new Response("No uploaded snapshot.", { status: 503 });
    if ((s.provider || "codex") !== provider)
      throw new Error("Stored snapshot provider mismatch.");
    const name =
      provider === "claude"
        ? "Claude Code"
        : provider === "cursor"
          ? "Cursor"
          : provider === "antigravity"
            ? "Antigravity"
            : "Codex";
    const title = `${provider.toUpperCase()} ATLAS`;
    // Only formatted numeric summaries reach the public SVG, never source strings or identifiers.
    const tokens =
        s.availability?.tokens === false
          ? "Unavailable"
          : compact(s.totals.totalTokens),
      sessions =
        s.availability?.sessions === false
          ? "Unavailable"
          : compact(s.totals.sessions);
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="150" viewBox="0 0 460 150" role="img" aria-label="Recorded ${name} usage"><rect width="459" height="149" x=".5" y=".5" rx="14" fill="#1b1e18" stroke="#3b4b2c"/><text x="24" y="33" fill="#b7ea76" font-family="sans-serif" font-size="13">⌘ ${title}</text><text x="24" y="82" fill="#eef2e7" font-family="sans-serif" font-size="32">${tokens}</text><text x="230" y="82" fill="#eef2e7" font-family="sans-serif" font-size="32">${sessions}</text><text x="24" y="105" fill="#93a582" font-family="sans-serif" font-size="11">RECORDED TOKENS</text><text x="230" y="105" fill="#93a582" font-family="sans-serif" font-size="11">SESSIONS</text><text x="24" y="132" fill="#718360" font-family="sans-serif" font-size="9">Available history · not verified account lifetime</text></svg>`,
      {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=300",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      },
    );
  } catch {
    return new Response("Widget temporarily unavailable.", { status: 503 });
  }
}
