import Link from "next/link";
import { Code2, Layers3, Rocket, Sparkles, Terminal } from "lucide-react";
import type { UsageProvider } from "@/lib/types";

const TABS = [
  { provider: "all", name: "All", href: "/all", icon: Layers3 },
  { provider: "codex", name: "Codex", href: "/", icon: Terminal },
  { provider: "claude", name: "Claude Code", href: "/claude", icon: Sparkles },
  { provider: "cursor", name: "Cursor", href: "/cursor", icon: Code2 },
  { provider: "antigravity", name: "Antigravity", href: "/antigravity", icon: Rocket },
];

// Provider tabs only. The README editor is reached from "Put on GitHub" and the setup wizard.
// Each tab tells the page transition which way to slide: a tab to the right moves forward.
export default function ProviderNavigation({ selected }: { selected: UsageProvider | "all" | "edit" }) {
  const current = TABS.findIndex((tab) => tab.provider === selected);
  return (
    <div className="provider-switch" role="navigation" aria-label="Usage product">
      {TABS.map(({ provider, name, href, icon: Icon }, i) => (
        <Link key={provider} href={href} className={selected === provider ? "selected" : ""}
          aria-current={selected === provider ? "page" : undefined}
          transitionTypes={current < 0 || i === current ? undefined : [i > current ? "nav-forward" : "nav-back"]}>
          <Icon size={12} /> {name}
        </Link>
      ))}
    </div>
  );
}
