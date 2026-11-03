import type { ReactNode } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { readLocalLink } from "@/lib/collector-link";
import { isCloud } from "@/lib/storage";
import DeployedOnly from "./deployed-only";

// The dashboard is only viewed on the deployed site. On a local copy it points to that site, or
// starts setup when this computer is not linked to one yet. Decided on the server, so the local
// dashboard never flashes up first.
export default async function LocalGate({ children }: { children: ReactNode }) {
  await connection(); // Decide per request, never at build time.
  if (isCloud()) return children;
  const link = await readLocalLink();
  if (!link) redirect("/setup");
  return <DeployedOnly site={link.site} />;
}
