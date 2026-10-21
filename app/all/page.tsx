import type { Metadata } from "next";
import AllDashboard from "@/components/all-dashboard";

export const metadata: Metadata = {
  title: "All · Atlas",
  description: "Your overall recorded usage across Codex, Claude Code, Cursor and Antigravity.",
};

export default function AllPage() {
  return <AllDashboard />;
}
