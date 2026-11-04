import { LOCAL_DASHBOARD_COOKIE } from "./setup-flow";

// Remembers, until the browser closes, that this visitor chose to see the local dashboard.
// It is a preference, not a credential: it only skips the "view it on your site" page.
export function chooseLocalDashboard() {
  document.cookie = `${LOCAL_DASHBOARD_COOKIE}=1; path=/; SameSite=Lax`;
}

