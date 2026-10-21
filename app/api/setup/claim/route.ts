import { NextResponse } from "next/server";
import { sessionCookieOptions, sessionToken } from "@/lib/auth";
import { claimInstance, setupState } from "@/lib/instance";
import { publicOrigin, sameOrigin } from "@/lib/origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// First visitor wins: the claim is a single atomic SET NX in storage.
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  const state = await setupState();
  if (!state.cloud)
    return NextResponse.json(
      { error: "Setup applies to deployed copies. Deploy to Vercel first." },
      { status: 503, headers },
    );
  if (state.storage !== "ok")
    return NextResponse.json(
      { error: "Redis storage is not connected to this project yet.", storage: state.storage },
      { status: 503, headers },
    );
  if (state.claimed)
    return NextResponse.json(
      { error: "This dashboard has already been claimed. Sign in instead." },
      { status: 409, headers },
    );
  try {
    const claim = await claimInstance();
    if (!claim)
      return NextResponse.json(
        { error: "This dashboard has already been claimed. Sign in instead." },
        { status: 409, headers },
      );
    const response = NextResponse.json(
      { password: claim.password, pairingCode: claim.pairingCode, origin: publicOrigin(request) },
      { headers },
    );
    response.cookies.set("atlas_session", sessionToken(claim.instance.sessionSecret), sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json(
      { error: "Could not save your claim. Try again." },
      { status: 503, headers },
    );
  }
}
