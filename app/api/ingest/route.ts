import { NextResponse } from "next/server";
import { isIngestAuthorized } from "@/lib/auth";
import { isCloud, saveSnapshot } from "@/lib/storage";
import { readBoundedJson, validateSnapshot } from "@/lib/validation";
import { providerFromUrl } from "@/lib/providers";
import type { UsageProvider } from "@/lib/types";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!(await isIngestAuthorized(request)))
    return NextResponse.json(
      { error: "Unauthorized collector." },
      { status: 401 },
    );
  if (!isCloud())
    return NextResponse.json(
      { error: "Ingestion requires ATLAS_MODE=cloud and durable storage." },
      { status: 503 },
    );
  let snapshot;
  let provider: UsageProvider;
  try {
    provider = providerFromUrl(request.url);
    snapshot = validateSnapshot(
      await readBoundedJson(request, 8 * 1024 * 1024),
    );
    if ((snapshot.provider || "codex") !== provider)
      throw new Error("Snapshot provider does not match upload destination.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid snapshot.";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Payload too large." ? 413 : 400 },
    );
  }
  try {
    const saved = await saveSnapshot({ ...snapshot, source: "cloud" });
    return NextResponse.json(
      saved
        ? { ok: true, generatedAt: snapshot.generatedAt }
        : { error: "Snapshot is older than the current upload." },
      { status: saved ? 200 : 409 },
    );
  } catch {
    return NextResponse.json(
      { error: "Cloud storage is unavailable or not configured." },
      { status: 503 },
    );
  }
}
