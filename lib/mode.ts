export function isCloud() {
  const mode = process.env.VIBE_CHECK_MODE;
  if (mode === "cloud") return true;
  if (mode === "local") return false;
  // Vercel sets VERCEL=1 at runtime, so a deployed copy needs no mode setting.
  return process.env.VERCEL === "1";
}
