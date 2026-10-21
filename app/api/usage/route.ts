import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { collectUsage } from "@/lib/collector";
import { collectClaudeUsage } from "@/lib/claude-collector";
import { collectCursorUsage } from "@/lib/cursor-collector";
import { collectAntigravityUsage } from "@/lib/antigravity-collector";
import { isCloud, readSnapshot } from "@/lib/storage";
import { providerFromUrl, providerName } from "@/lib/providers";
import type { UsageProvider, UsageSnapshot } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cached = new Map<UsageProvider, UsageSnapshot>();
const pending = new Map<UsageProvider, Promise<UsageSnapshot>>();
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
    let snapshot: UsageSnapshot | null;
    if (isCloud()) {
      snapshot = await readSnapshot(provider);
      if (!snapshot)
        return NextResponse.json(
          {
            error: `No ${providerName(provider)} cloud snapshot yet. Run the collector with --provider ${provider} to upload usage.`,
          },
          { status: 503 },
        );
      if ((snapshot.provider || "codex") !== provider)
        throw new Error("Stored snapshot provider mismatch.");
      snapshot = { ...snapshot, source: "cloud" };
    } else {
      snapshot = cached.get(provider) || null;
      if (!snapshot || Date.now() - Date.parse(snapshot.generatedAt) > 10_000) {
        let job = pending.get(provider);
        if (!job) {
          job = (
            provider === "antigravity"
              ? collectAntigravityUsage()
              : provider === "claude"
              ? collectClaudeUsage()
              : provider === "cursor"
                ? collectCursorUsage()
                : collectUsage()
          ).finally(() => {
            pending.delete(provider);
          });
          pending.set(provider, job);
        }
        snapshot = await job;
        cached.set(provider, snapshot);
      }
    }
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
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
