import Link from "next/link";
import { Code2, Layers3, Rocket, Sparkles, Terminal } from "lucide-react";
import type { UsageProvider } from "@/lib/types";

// Provider tabs only. The README editor is reached from "Put on GitHub" and the setup wizard.
export default function ProviderNavigation({ selected }: { selected: UsageProvider | "all" | "edit" }) {
  return (
    <div className="provider-switch" role="navigation" aria-label="Usage product">
      {[
        { provider: "codex", name: "Codex", href: "/", icon: Terminal },
        { provider: "claude", name: "Claude Code", href: "/claude", icon: Sparkles },
        { provider: "cursor", name: "Cursor", href: "/cursor", icon: Code2 },
        { provider: "all", name: "All", href: "/all", icon: Layers3 },
        { provider: "antigravity", name: "Antigravity", href: "/antigravity", icon: Rocket },
      ].map(({ provider, name, href, icon: Icon }) => (
        <Link key={provider} href={href} className={selected === provider ? "selected" : ""}
          aria-current={selected === provider ? "page" : undefined}>
          <Icon size={12} /> {name}
        </Link>
      ))}
    </div>
  );
}
