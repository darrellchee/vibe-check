import { readSnapshot } from "@/lib/storage";
import { providerFromUrl } from "@/lib/providers";
import { cardOptions, renderActivityCalendar, renderProfileCard } from "@/lib/profile-card";
import { cardsPublic } from "@/lib/instance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const fail = (message: string, status: number) => new Response(message, {
    status, headers: { "Cache-Control": "no-store" },
  });
  let provider, options;
  try {
    const url = new URL(request.url);
    provider = providerFromUrl(request.url);
    options = cardOptions(url);
  } catch {
    return fail("Invalid card options. Choose a supported provider, light/dark theme, kind=usage or calendar, style, accent, and tokens,sessions,requests metrics.", 400);
  }
  if (!(await cardsPublic(provider))) return fail("Public card is disabled.", 404);
  try {
    const snapshot = await readSnapshot(provider);
    if (!snapshot) return fail("No synced snapshot yet. Run the local collector.", 503);
    if ((snapshot.provider || "codex") !== provider) throw new Error("Provider mismatch.");
    const svg = options.kind === "calendar"
      ? renderActivityCalendar(snapshot, provider, options.theme, { style: options.style, accent: options.accent })
      : renderProfileCard(snapshot, provider, options.theme, options.metrics, { style: options.style, accent: options.accent });
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return fail("Card temporarily unavailable.", 503);
  }
}
