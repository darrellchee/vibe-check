import { headers } from "next/headers";
import { isAuthorized } from "@/lib/auth";
import { PROVIDERS } from "@/lib/providers";
import { readyUsage } from "@/lib/usage-source";
import type { HarnessUsage } from "@/lib/overview";
import type { UsageProvider } from "@/lib/types";
import Dashboard from "./dashboard";

// Server components that hand each dashboard its usage with the page itself, so the numbers
// arrive in the first response instead of after the scripts load and ask for them.
// Anything not ready (signed out, nothing collected yet, storage error) renders the dashboard
// empty, and it loads in the browser as before.

async function signedIn() {
  const cookie = (await headers()).get("cookie") ?? "";
  return isAuthorized(new Request("http://localhost/", { headers: { cookie } }));
}

export async function DashboardWithUsage({ provider }: { provider: UsageProvider }) {
  const ready = (await signedIn()) ? await readyUsage(provider) : null;
  const usage = ready && "snapshot" in ready ? ready : null;
  return <Dashboard key={provider} provider={provider} initial={usage?.snapshot} initialStale={usage?.stale} />;
}

export async function AllDashboardWithUsage() {
  let initial: HarnessUsage[] | undefined;
  let stale = false;
  if (await signedIn()) {
    const ready = await Promise.all(PROVIDERS.map(readyUsage));
    if (ready.every(Boolean)) {
      initial = ready.map((result, i): HarnessUsage =>
        "snapshot" in result! ? { provider: PROVIDERS[i], snapshot: result.snapshot } : { provider: PROVIDERS[i], error: result!.error });
      stale = ready.some((result) => result && "stale" in result && result.stale);
    }
  }
  return <Dashboard key="all" provider="all" initialHarnesses={initial} initialStale={stale} />;
}
