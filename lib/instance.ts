import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { isCloud, redis, storageConfigured } from "./storage";
import { widgetFlag } from "./providers";
import type { UsageProvider } from "./types";

// Runtime-generated credentials let a deployed copy work with zero environment
// secrets: the first visitor claims the instance, and every collector pairs with
// a single-use code. Only hashes are stored, so a Redis leak reveals no secret.
const INSTANCE_KEY = "atlas:instance:v1";
const TOKENS_KEY = "atlas:sync-tokens:v1";
const pairKey = (code: string) => `atlas:pair:v1:${sha256(code)}`;
export const PAIRING_TTL_SECONDS = 900;
const CODE_PATTERN = /^[a-f0-9]{24}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type Instance = {
  v: 1;
  claimedAt: string;
  sessionSecret: string;
  salt: string;
  hash: string;
  // Cards for every provider, including ones added later, unless an env flag says otherwise.
  publicCards: boolean;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hashPassword = (password: string, salt: string) =>
  scryptSync(password, salt, 64).toString("hex");

export type SetupState =
  | { cloud: false }
  | { cloud: true; storage: "missing" | "error" }
  | { cloud: true; storage: "ok"; claimed: boolean; managedByEnv: boolean };

function parseInstance(value: unknown): Instance | null {
  if (typeof value !== "string") return null;
  const parsed = JSON.parse(value);
  return parsed?.v === 1 &&
    typeof parsed.sessionSecret === "string" &&
    typeof parsed.salt === "string" &&
    typeof parsed.hash === "string"
    ? (parsed as Instance)
    : null;
}

export async function readInstance(): Promise<Instance | null> {
  if (!isCloud() || !storageConfigured()) return null;
  return parseInstance(await redis(["GET", INSTANCE_KEY]));
}

export async function setupState(): Promise<SetupState> {
  if (!isCloud()) return { cloud: false };
  if (!storageConfigured()) return { cloud: true, storage: "missing" };
  const managedByEnv = Boolean(process.env.DASHBOARD_PASSWORD);
  try {
    return {
      cloud: true,
      storage: "ok",
      claimed: managedByEnv || (await readInstance()) !== null,
      managedByEnv,
    };
  } catch {
    return { cloud: true, storage: "error" };
  }
}

export async function createPairingCode() {
  const code = randomBytes(12).toString("hex");
  const saved = await redis(["SET", pairKey(code), "1", "EX", PAIRING_TTL_SECONDS, "NX"]);
  if (saved !== "OK") throw new Error("Could not create a connect code.");
  return code;
}

// Atomic first-writer-wins: SET NX means exactly one visitor can claim.
export async function claimInstance() {
  const password = randomBytes(18).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const instance: Instance = {
    v: 1,
    claimedAt: new Date().toISOString(),
    sessionSecret: randomBytes(32).toString("hex"),
    salt,
    hash: hashPassword(password, salt),
    publicCards: true,
  };
  const saved = await redis(["SET", INSTANCE_KEY, JSON.stringify(instance), "NX"]);
  if (saved !== "OK") return null;
  return { password, instance, pairingCode: await createPairingCode() };
}

export function verifyPassword(input: string, instance: Instance) {
  const expected = Buffer.from(instance.hash, "hex");
  const actual = Buffer.from(hashPassword(input, instance.salt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// GETDEL consumes the code atomically, so a code can be redeemed exactly once.
export async function redeemPairingCode(code: unknown) {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return null;
  if ((await redis(["GETDEL", pairKey(code)])) === null) return null;
  const token = randomBytes(32).toString("hex");
  await redis(["SADD", TOKENS_KEY, sha256(token)]);
  return token;
}

export async function isSyncToken(token: string) {
  if (!TOKEN_PATTERN.test(token) || !isCloud() || !storageConfigured()) return false;
  return (await redis(["SISMEMBER", TOKENS_KEY, sha256(token)])) === 1;
}

// An explicit PUBLIC_*_WIDGET env value always wins; otherwise a claimed instance
// publishes cards for every provider. Storage failures fail closed (private).
export async function cardsPublic(provider: UsageProvider) {
  const explicit = process.env[widgetFlag(provider)];
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  try {
    return (await readInstance())?.publicCards === true;
  } catch {
    return false;
  }
}
