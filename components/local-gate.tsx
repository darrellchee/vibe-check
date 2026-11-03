import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readLocalLink } from "@/lib/collector-link";
import { gateView, LOCAL_DASHBOARD_COOKIE } from "@/lib/setup-flow";
import { isCloud } from "@/lib/storage";
import DeployedOnly from "./deployed-only";

// On a local copy, the first thing a visitor sees is a page pointing to the deployed site (or
// setup, when this computer is not linked yet). "Visit dashboard" there opens the local dashboard
// for the rest of the browser session. Decided on the server, so nothing flashes first.
export default async function LocalGate({ children }: { children: ReactNode }) {
  const chosen = (await cookies()).get(LOCAL_DASHBOARD_COOKIE)?.value === "1"; // Per request, never at build time.
  const cloud = isCloud();
  const link = cloud || chosen ? null : await readLocalLink();
  const view = gateView({ cloud, linked: Boolean(link), chosen });
  if (view === "setup") redirect("/setup");
  if (view === "deployed-only" && link) return <DeployedOnly site={link.site}>{children}</DeployedOnly>;
  return children;
}
