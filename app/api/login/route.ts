import { NextResponse } from "next/server";
import { equalSecret, sessionCookieOptions, sessionToken } from "@/lib/auth";
import { readInstance, verifyPassword } from "@/lib/instance";
import { sameOrigin } from "@/lib/origin";
import { readBoundedJson } from "@/lib/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  const envPassword = process.env.DASHBOARD_PASSWORD;
  let instance = null;
  if (!envPassword) {
    try {
      instance = await readInstance();
    } catch {
      return NextResponse.json(
        { error: "Could not reach storage. Try again shortly." },
        { status: 503 },
      );
    }
    if (!instance)
      return NextResponse.json(
        { error: "This dashboard is not set up yet. Open /setup to claim it." },
        { status: 503 },
      );
  }
  let input;
  try {
    input = await readBoundedJson(request, 4096);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const supplied =
    input && typeof input === "object" && "password" in input && typeof input.password === "string"
      ? input.password
      : null;
  const valid =
    supplied !== null &&
    (envPassword
      ? equalSecret(supplied, envPassword)
      : verifyPassword(supplied, instance!));
  if (!valid)
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    "atlas_session",
    sessionToken(envPassword || instance!.sessionSecret),
    sessionCookieOptions(),
  );
  return response;
}
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("atlas_session", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
