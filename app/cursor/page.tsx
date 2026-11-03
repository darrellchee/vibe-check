import type { Metadata } from "next";
import Dashboard from "@/components/dashboard";
import LocalGate from "@/components/local-gate";
export const metadata: Metadata = {
  title: "Cursor Atlas · Your work, in perspective",
  description:
    "Your recorded Cursor usage: imported tokens, model distributions, activity and API-equivalent estimates.",
};
export default function CursorPage() {
  return <LocalGate><Dashboard key="cursor" provider="cursor" /></LocalGate>;
}
