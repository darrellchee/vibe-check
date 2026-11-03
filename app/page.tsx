import Dashboard from "@/components/dashboard";
import LocalGate from "@/components/local-gate";
export default function Page() {
  return <LocalGate><Dashboard key="codex" provider="codex" /></LocalGate>;
}
