import type { Metadata } from "next";
import Dashboard from "@/components/dashboard";
export const metadata: Metadata = {
  title: "Claude Atlas · Your work, in perspective",
  description:
    "Your recorded Claude Code usage: tokens, activity, models and API-equivalent value.",
};
export default function ClaudePage() {
  return <Dashboard key="claude" provider="claude" />;
}
