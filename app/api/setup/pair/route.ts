import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { createPairingCode, PAIRING_TTL_SECONDS } from "@/lib/instance";
import { publicOrigin, sameOrigin } from "@/lib/origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// Owner-only: mint a fresh single-use connect code, e.g. for a second computer.
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  if (!(await isAuthorized(request)))
    return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
  try {
    return NextResponse.json(
      { pairingCode: await createPairingCode(), origin: publicOrigin(request), expiresInSeconds: PAIRING_TTL_SECONDS },
      { headers },
    );
  } catch {
    return NextResponse.json({ error: "Storage is unavailable." }, { status: 503, headers });
  }
}
