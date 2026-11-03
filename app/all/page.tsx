import type { Metadata } from "next";
import AllDashboard from "@/components/all-dashboard";
import LocalGate from "@/components/local-gate";

export const metadata: Metadata = {
  title: "All · Atlas",
  description: "Your overall recorded usage across Codex, Claude Code, Cursor and Antigravity.",
};

export default function AllPage() {
  return <LocalGate><AllDashboard /></LocalGate>;
}
