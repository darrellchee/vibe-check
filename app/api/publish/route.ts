import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { availability, gh, GhError, publishReadme } from "@/lib/github-publish";
import { sameOrigin } from "@/lib/origin";
import { isCloud } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const MAX_MARKDOWN = 400_000;
let publishing = false;

const fail = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof GhError ? error.message : "Could not reach GitHub. Try again." },
    { status: 502, headers },
  );

// Whether one-click publishing is possible here, and what the profile repository looks like.
export async function GET(request: Request) {
  if (!(await isAuthorized(request)))
    return NextResponse.json({ error: "Sign in to publish." }, { status: 401, headers });
  // A deployed copy has no GitHub CLI or owner session; the editor falls back to GitHub's web page.
  if (isCloud()) return NextResponse.json({ available: false, reason: "cloud" }, { headers });
  try {
    return NextResponse.json(await availability(gh.run), { headers });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  if (!(await isAuthorized(request)))
    return NextResponse.json({ error: "Sign in to publish." }, { status: 401, headers });
  if (isCloud())
    return NextResponse.json({ error: "One-click publishing runs from your own computer." }, { status: 503, headers });
  let markdown: unknown;
  try {
    markdown = (await request.json())?.markdown;
  } catch {
    return NextResponse.json({ error: "Send the README as JSON." }, { status: 400, headers });
  }
  if (typeof markdown !== "string" || !markdown.trim())
    return NextResponse.json({ error: "There is no README to publish yet." }, { status: 400, headers });
  if (markdown.length > MAX_MARKDOWN)
    return NextResponse.json({ error: "This README is too large for GitHub. Remove some content." }, { status: 413, headers });
  if (publishing) return NextResponse.json({ error: "A publish is already running." }, { status: 409, headers });
  publishing = true;
  try {
    return NextResponse.json(await publishReadme(gh.run, markdown), { headers });
  } catch (error) {
    return fail(error);
  } finally {
    publishing = false;
  }
}
