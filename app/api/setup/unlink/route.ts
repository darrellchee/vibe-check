import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { readLocalLink, unlinkLocal } from "@/lib/collector-link";
import { publicHost, sameOrigin } from "@/lib/origin";
import { isCloud } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// Unlinks this computer from its deployed site: stops the collector service and removes the site
// and upload token from its settings. Only a local copy, opened on this computer, can do this.
export async function POST(request: Request) {
  if (isCloud())
    return NextResponse.json({ error: "Unlinking is done from the computer that uploads." }, { status: 404, headers });
  if (!request.headers.get("origin") || !sameOrigin(request) || !LOOPBACK.test(publicHost(request)))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  if (!(await isAuthorized(request)))
    return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
  if (!(await readLocalLink()))
    return NextResponse.json({ unlinked: true }, { headers });
  try {
    await unlinkLocal();
    return NextResponse.json({ unlinked: true }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Could not stop the collector. Run npm run collector:uninstall in ~/.vibe-check, then try again." },
      { status: 500, headers },
    );
  }
}
