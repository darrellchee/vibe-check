import { readSnapshot } from "@/lib/storage";
import { PROVIDERS, cardProviderFromUrl } from "@/lib/providers";
import { combineSnapshots } from "@/lib/overview";
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
    provider = cardProviderFromUrl(request.url);
    options = cardOptions(url);
  } catch {
    return fail("Invalid card options. Choose a supported provider (or all), light/dark theme, kind=usage or calendar, style, accent, and tokens,sessions,requests,cost metrics.", 400);
  }
  try {
    let snapshot;
    if (provider === "all") {
      // Only harnesses whose own card is public are added up, so the combined card can never reveal
      // a total the owner switched off.
      const shared = (await Promise.all(PROVIDERS.map(async (p) => ((await cardsPublic(p)) ? p : null)))).filter((p) => p !== null);
      if (!shared.length) return fail("Public card is disabled.", 404);
      const stored = await Promise.all(shared.map((p) => readSnapshot(p)));
      snapshot = combineSnapshots(stored.flatMap((s, i) => {
        if (!s) return [];
        if ((s.provider || "codex") !== shared[i]) throw new Error("Provider mismatch.");
        return [s];
      }));
    } else {
      if (!(await cardsPublic(provider))) return fail("Public card is disabled.", 404);
      snapshot = await readSnapshot(provider);
      if (snapshot && (snapshot.provider || "codex") !== provider) throw new Error("Provider mismatch.");
    }
    if (!snapshot) return fail("No synced snapshot yet. Run the local collector.", 503);
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
