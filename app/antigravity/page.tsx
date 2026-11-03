import type { Metadata } from "next";
import { DashboardWithUsage } from "@/components/usage-loaders";
import LocalGate from "@/components/local-gate";
export const metadata: Metadata = {
  title: "Antigravity Vibe Check · Your work, in perspective",
  description:
    "Your recorded Antigravity usage: tokens by model, activity, distributions and API-equivalent estimates.",
};
export default function AntigravityPage() {
  return <LocalGate><DashboardWithUsage provider="antigravity" /></LocalGate>;
}
