import type { Metadata } from "next";
import { DashboardWithUsage } from "@/components/usage-loaders";
import LocalGate from "@/components/local-gate";
export const metadata: Metadata = {
  title: "Cursor Vibe Check · Your work, in perspective",
  description:
    "Your recorded Cursor usage: imported tokens, model distributions, activity and API-equivalent estimates.",
};
export default function CursorPage() {
  return <LocalGate><DashboardWithUsage provider="cursor" /></LocalGate>;
}
