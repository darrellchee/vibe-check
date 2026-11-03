"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import s from "./setup.module.css";

// Shown instead of the dashboard on a local copy that is linked to a deployed site.
export default function DeployedOnly({ site }: { site: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const host = new URL(site).host;

  async function unlink() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup/unlink", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not unlink this computer.");
      router.replace("/setup");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlink this computer.");
      setBusy(false);
    }
  }

  return (
    <main className={s.page}>
      <section className={s.body}>
        <h1 className={s.title}>You can only view your project in the deployed version</h1>
        <p className={s.lead}>This computer uploads your usage to {host}. Open it there to see your dashboard.</p>
        <a className={s.primary} href={site}>
          Open deployed version <ExternalLink size={16} />
        </a>
        {confirming ? (
          <div className={s.confirm} role="group" aria-label="Unlink this computer">
            <p className={s.hint}>This stops uploading usage from this computer to {host}. Usage already uploaded stays there.</p>
            <div className={s.actions}>
              <button className={s.secondary} onClick={() => void unlink()} disabled={busy}>{busy ? "Unlinking…" : "Unlink"}</button>
              <button className={s.link} onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className={s.link} onClick={() => setConfirming(true)}>Unlink this computer from {host}</button>
        )}
        {error && <p className={s.error} role="alert">{error}</p>}
      </section>
    </main>
  );
}
