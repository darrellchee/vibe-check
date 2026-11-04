import { NextResponse } from "next/server";
import { rememberSite } from "@/lib/collector-link";
import { publicHost, sameOrigin } from "@/lib/origin";
import { isCloud } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// A local copy keeps the address of the site deployed from it, so its setup can offer to reconnect
// later. It stores only a public HTTPS origin and never links this computer or uploads anything.
export async function POST(request: Request) {
  if (isCloud()) return NextResponse.json({ error: "Not available on a deployed site." }, { status: 404, headers });
  if (!request.headers.get("origin") || !sameOrigin(request) || !LOOPBACK.test(publicHost(request)))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  const site = typeof body?.site === "string" ? await rememberSite(body.site) : null;
  if (!site) return NextResponse.json({ error: "Enter your site's https:// address." }, { status: 400, headers });
  return NextResponse.json({ site }, { headers });
}
