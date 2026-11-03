import { DashboardWithUsage } from "@/components/usage-loaders";
import LocalGate from "@/components/local-gate";
export default function Page() {
  return <LocalGate><DashboardWithUsage provider="codex" /></LocalGate>;
}
