import type { Metadata } from "next";
import { DashboardWithUsage } from "@/components/usage-loaders";
import LocalGate from "@/components/local-gate";
export const metadata: Metadata = {
  title: "Claude Vibe Check · Your work, in perspective",
  description:
    "Your recorded Claude Code usage: tokens, activity, models and API-equivalent value.",
};
export default function ClaudePage() {
  return <LocalGate><DashboardWithUsage provider="claude" /></LocalGate>;
}
