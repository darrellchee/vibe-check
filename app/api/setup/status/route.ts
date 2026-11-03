import { NextResponse } from "next/server";
import { setupState } from "@/lib/instance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public by design: it only says whether setup is possible and whether someone has claimed it.
// CORS lets a README preview on another origin explain why that site's cards are disabled.
export async function GET() {
  return NextResponse.json(await setupState(), {
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}
