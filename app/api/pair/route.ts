import { NextResponse } from "next/server";
import { redeemPairingCode } from "@/lib/instance";
import { readBoundedJson } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// Called by the install script: exchanges a single-use code for a per-machine sync token.
export async function POST(request: Request) {
  let input;
  try {
    input = await readBoundedJson(request, 512);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  }
  try {
    const token = await redeemPairingCode(
      input && typeof input === "object" && "code" in input ? input.code : null,
    );
    return token
      ? NextResponse.json({ token }, { headers })
      : NextResponse.json({ error: "Invalid or expired connect code." }, { status: 401, headers });
  } catch {
    return NextResponse.json({ error: "Storage is unavailable." }, { status: 503, headers });
  }
}
