import { installScript } from "@/lib/install-script";
import { publicOrigin } from "@/lib/origin";
import { UPSTREAM_REPOSITORY } from "@/lib/profile-card";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return new Response(installScript(publicOrigin(request), `${UPSTREAM_REPOSITORY}.git`), {
      headers: {
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Unsupported host.", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
