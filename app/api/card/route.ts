import { readSnapshot } from "@/lib/storage";
import { PROVIDERS, cardProviderFromUrl } from "@/lib/providers";
import { combineSnapshots } from "@/lib/overview";
import { cardOptions, renderCard } from "@/lib/profile-card";
import { cardsPublic } from "@/lib/instance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cards are public images. CORS lets a README preview on another origin (such as a local copy) read
// the status code to warn about cards GitHub could not load; the body is the same either way.
const CORS = { "Access-Control-Allow-Origin": "*" };

export async function GET(request: Request) {
  const fail = (message: string, status: number) => new Response(message, {
    status, headers: { "Cache-Control": "no-store", ...CORS },
  });
  let provider, options;
  try {
    const url = new URL(request.url);
    provider = cardProviderFromUrl(request.url);
    options = cardOptions(url);
    // Only the combined snapshot knows how usage splits across harnesses.
    if (options.kind === "harnesses" && provider !== "all") throw new Error("Harness cards are for provider=all.");
  } catch {
    return fail("Invalid card options. Choose a supported provider (or all), light/dark theme, kind=usage, calendar, trend, models, ledger or harnesses (provider=all), style, accent, font, and tokens,sessions,requests,cost metrics.", 400);
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
    const { theme, ...request } = options;
    const svg = renderCard(snapshot, provider, theme, request);
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
        // Animated cards carry their CSS in a <style> element, so inline styles are allowed; scripts never are.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
        ...CORS,
      },
    });
  } catch {
    return fail("Card temporarily unavailable.", 503);
  }
}
