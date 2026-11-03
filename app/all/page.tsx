import type { Metadata } from "next";
import { AllDashboardWithUsage } from "@/components/usage-loaders";
import LocalGate from "@/components/local-gate";

export const metadata: Metadata = {
  title: "All · Vibe Check",
  description: "Your overall recorded usage across Codex, Claude Code, Cursor and Antigravity.",
};

export default function AllPage() {
  return <LocalGate><AllDashboardWithUsage /></LocalGate>;
}
