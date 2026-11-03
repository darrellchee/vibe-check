import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { isCloud, storageConfigured } from "./storage";
import { kv } from "./kv";
import { widgetFlag } from "./providers";
import { readLocalLink } from "./collector-link";
import type { UsageProvider } from "./types";

// Runtime-generated credentials let a deployed copy work with zero environment
// secrets: the first visitor claims the instance, and every collector pairs with
// a single-use code. Only hashes are stored, so a storage leak reveals no password or token.
const INSTANCE_KEY = "vibe-check:instance:v1";
const TOKENS_KEY = "vibe-check:sync-tokens:v1";
const pairKey = (code: string) => `vibe-check:pair:v1:${sha256(code)}`;
// Sites deployed before the rename kept everything under "atlas" names. Those are still read, so an
// updated site keeps its owner, password and connected computers instead of becoming claimable.
const LEGACY_INSTANCE_KEY = "atlas:instance:v1";
const LEGACY_TOKENS_KEY = "atlas:sync-tokens:v1";
const legacyPairKey = (code: string) => `atlas:pair:v1:${sha256(code)}`;
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
  // A local copy: `site` is the deployed site it uploads to, once the connect command has linked it.
  | { cloud: false; site: string | null }
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

// The stored owner record, copying a pre-rename one forward the first time it is found. The copy is a
// write-if-absent, so it can never replace an owner, and a claim that races it simply loses.
async function storedInstance(): Promise<string | null> {
  const store = kv();
  const current = await store.get(INSTANCE_KEY);
  if (current !== null) return current;
  const legacy = await store.get(LEGACY_INSTANCE_KEY);
  if (legacy === null) return null;
  await store.setIfAbsent(INSTANCE_KEY, legacy);
  return store.get(INSTANCE_KEY);
}

export async function readInstance(): Promise<Instance | null> {
  if (!isCloud() || !storageConfigured()) return null;
  return parseInstance(await storedInstance());
}

export async function setupState(): Promise<SetupState> {
  if (!isCloud()) return { cloud: false, site: (await readLocalLink())?.site ?? null };
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
  if (!(await kv().setIfAbsent(pairKey(code), "1", PAIRING_TTL_SECONDS)))
    throw new Error("Could not create a connect code.");
  return code;
}

// Atomic first-writer-wins: a write-if-absent means exactly one visitor can claim.
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
  // An owner from before the rename is copied forward first, so it blocks this claim like any other.
  if ((await storedInstance()) !== null) return null;
  if (!(await kv().setIfAbsent(INSTANCE_KEY, JSON.stringify(instance)))) return null;
  return { password, instance, pairingCode: await createPairingCode() };
}

export function verifyPassword(input: string, instance: Instance) {
  const expected = Buffer.from(instance.hash, "hex");
  const actual = Buffer.from(hashPassword(input, instance.salt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Taking the code reads and deletes it atomically, so a code can be redeemed exactly once.
export async function redeemPairingCode(code: unknown) {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return null;
  // A code made just before the update may still be under its old name.
  if ((await kv().take(pairKey(code))) === null && (await kv().take(legacyPairKey(code))) === null) return null;
  const token = randomBytes(32).toString("hex");
  await kv().addMember(TOKENS_KEY, sha256(token));
  return token;
}

export async function isSyncToken(token: string) {
  if (!TOKEN_PATTERN.test(token) || !isCloud() || !storageConfigured()) return false;
  const hash = sha256(token);
  if (await kv().hasMember(TOKENS_KEY, hash)) return true;
  if (!(await kv().hasMember(LEGACY_TOKENS_KEY, hash))) return false;
  await kv().addMember(TOKENS_KEY, hash); // Collectors paired before the rename keep working.
  return true;
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
