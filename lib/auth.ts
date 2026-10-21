import { createHmac, timingSafeEqual } from "node:crypto";
import { isSyncToken, readInstance } from "./instance";
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function sessionToken(
  password: string,
  day = Math.floor(Date.now() / 86_400_000),
) {
  return `${day}.${createHmac("sha256", password).update(`codex-atlas-session:${day}`).digest("hex")}`;
}
export function validSession(value: string, password: string) {
  return [0, 1].some((offset) =>
    equalSecret(
      value,
      sessionToken(password, Math.floor(Date.now() / 86_400_000) - offset),
    ),
  );
}
export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 86_400,
});
const sessionCookie = (request: Request) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("atlas_session="))
    ?.slice(14) || "";
export function authorized(request: Request) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return process.env.NODE_ENV !== "production";
  return validSession(sessionCookie(request), password);
}
// Env credentials win; otherwise a claimed instance signs sessions with its stored secret.
// Unclaimed or unreachable storage falls back to authorized(), which is closed in production.
export async function isAuthorized(request: Request) {
  if (process.env.DASHBOARD_PASSWORD) return authorized(request);
  try {
    const instance = await readInstance();
    if (instance) return validSession(sessionCookie(request), instance.sessionSecret);
  } catch {
    /* Fall through to the fail-closed default. */
  }
  return authorized(request);
}
export function ingestionAuthorized(request: Request) {
  const token = process.env.SYNC_TOKEN;
  return (
    !!token &&
    token.length >= 32 &&
    equalSecret(request.headers.get("authorization") || "", `Bearer ${token}`)
  );
}
export async function isIngestAuthorized(request: Request) {
  if (ingestionAuthorized(request)) return true;
  const bearer = (request.headers.get("authorization") || "").match(/^Bearer ([a-f0-9]{64})$/);
  if (!bearer) return false;
  try {
    return await isSyncToken(bearer[1]);
  } catch {
    return false;
  }
}
