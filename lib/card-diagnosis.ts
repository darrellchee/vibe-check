import type { SetupState } from "./instance";

// Why a deployed site answers "Public card is disabled", read from its public /api/setup/status.
// The first three apply to every card on the site; "flag" means a PUBLIC_*_WIDGET setting turned
// this card off; "unknown" covers anything the status cannot explain (an older site, a network error).
export type DisabledReason = "storage-missing" | "storage-error" | "unclaimed" | "env-managed" | "flag" | "unknown";

export function disabledReason(status: unknown): DisabledReason {
  const state = status as Partial<SetupState> | null;
  if (!state || typeof state !== "object" || state.cloud !== true || !("storage" in state)) return "unknown";
  if (state.storage === "missing") return "storage-missing";
  if (state.storage === "error") return "storage-error";
  if (state.storage !== "ok" || !("claimed" in state)) return "unknown";
  if (!state.claimed) return "unclaimed";
  // A password set in the environment counts as claimed, but no claim record turns cards on,
  // so each card stays private until its PUBLIC_*_WIDGET is true.
  if (state.managedByEnv) return "env-managed";
  return "flag";
}

// One message for the whole site when every card is off for the same reason, or null when the
// reason is per card and the caller should name each card instead.
export function siteWideMessage(reason: DisabledReason): string | null {
  switch (reason) {
    case "storage-missing":
      return "Your site has no storage connected, so it cannot publish cards and the images will not load on GitHub. In Vercel, connect a database (Storage → Upstash Redis) to the project, redeploy, then finish setup at /setup.";
    case "storage-error":
      return "Your site cannot reach its storage, so it cannot publish cards and the images will not load on GitHub. Check the storage connection in Vercel, then redeploy.";
    case "unclaimed":
      return "Your site has not finished setup, so its cards stay private and the images will not load on GitHub. Open /setup on your site to claim it.";
    default:
      return null;
  }
}

// What to do about one disabled card once the site itself is set up.
export function cardFix(reason: DisabledReason): string {
  if (reason === "env-managed")
    return "This site's password comes from DASHBOARD_PASSWORD, so cards are off until you set PUBLIC_*_WIDGET=true in Vercel and redeploy.";
  if (reason === "flag") return "Remove the PUBLIC_*_WIDGET=false setting in Vercel and redeploy.";
  return "Check that the site has finished setup and that no PUBLIC_*_WIDGET variable is set to false in Vercel, then redeploy.";
}
