import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { isCloud } from "@/lib/storage";
import { MissingCloudSnapshot, usageFor } from "@/lib/usage-source";
import { providerFromUrl, providerName } from "@/lib/providers";
import type { UsageProvider } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!(await isAuthorized(request)))
    return NextResponse.json(
      { error: "Sign in to view this dashboard." },
      { status: 401 },
    );
  let provider: UsageProvider;
  try {
    provider = providerFromUrl(request.url);
  } catch {
    return NextResponse.json(
      { error: "Unknown usage provider. Choose codex, claude, cursor or antigravity." },
      { status: 400 },
    );
  }
  try {
    const { snapshot, stale } = await usageFor(provider);
    return NextResponse.json(snapshot, {
      // Stale means "saved from an earlier run, fresh numbers are on the way": poll again soon.
      headers: { "Cache-Control": "private, no-store", ...(stale ? { "X-Usage-Stale": "1" } : {}) },
    });
  } catch (error) {
    if (error instanceof MissingCloudSnapshot)
      return NextResponse.json({ error: error.message }, { status: 503 });
    console.error(
      "Usage collection failed:",
      error instanceof Error ? error.name : "unknown",
    );
    return NextResponse.json(
      {
        error: isCloud()
          ? "Could not read cloud storage. Check the server configuration and try again."
          : `Could not read ${providerName(provider)} history. Check ${provider === "claude" ? "CLAUDE_HOME" : provider === "cursor" ? "CURSOR_USAGE_CSV / CURSOR_DB_PATH" : provider === "antigravity" ? "ANTIGRAVITY_HOME" : "CODEX_HOME"} and file permissions.`,
      },
      { status: 503 },
    );
  }
}
