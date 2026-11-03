import type { Metadata } from "next";
import Dashboard from "@/components/dashboard";
import LocalGate from "@/components/local-gate";
export const metadata: Metadata = {
  title: "Claude Atlas · Your work, in perspective",
  description:
    "Your recorded Claude Code usage: tokens, activity, models and API-equivalent value.",
};
export default function ClaudePage() {
  return <LocalGate><Dashboard key="claude" provider="claude" /></LocalGate>;
}
