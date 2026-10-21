import type { Metadata } from "next";
import Dashboard from "@/components/dashboard";
export const metadata: Metadata = {
  title: "Antigravity Atlas · Your work, in perspective",
  description:
    "Your recorded Antigravity usage: tokens by model, activity, distributions and API-equivalent estimates.",
};
export default function AntigravityPage() {
  return <Dashboard key="antigravity" provider="antigravity" />;
}
