// Databases a deployed copy can store its data in. Each one is a Vercel Marketplace integration, so
// the deploy button can create it (or connect one the user already has) with no environment values
// to type. The server picks whichever one's variables it finds; see lib/kv.ts.
// Client-safe: no Node imports, because the setup page builds deploy links from this list.

export type StorageProviderId = "upstash" | "neon" | "turso" | "redis" | "supabase";

export type StorageProvider = {
  id: StorageProviderId;
  name: string;
  // What the free plan gives, in a few words, so people can pick one they have not used up.
  free: string;
  integrationSlug: string;
  productSlug: string;
};

export const STORAGE_PROVIDERS: readonly StorageProvider[] = [
  { id: "upstash", name: "Upstash Redis", free: "1 free database, 500K commands a month", integrationSlug: "upstash", productSlug: "upstash-kv" },
  { id: "neon", name: "Neon Postgres", free: "Up to 100 free projects", integrationSlug: "neon", productSlug: "neon" },
  { id: "turso", name: "Turso", free: "Hundreds of free databases", integrationSlug: "tursocloud", productSlug: "database" },
  { id: "redis", name: "Redis Cloud", free: "1 free 30 MB database", integrationSlug: "redis", productSlug: "redis" },
  { id: "supabase", name: "Supabase", free: "2 free projects, paused after a week idle", integrationSlug: "supabase", productSlug: "supabase" },
];

export const DEFAULT_STORAGE: StorageProviderId = "upstash";

export function storageProvider(id: StorageProviderId = DEFAULT_STORAGE): StorageProvider {
  const provider = STORAGE_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown storage provider: ${id}`);
  return provider;
}

// The Marketplace page for adding the database to a project that is already deployed.
export const marketplaceUrl = (provider: StorageProvider) =>
  `https://vercel.com/marketplace/${provider.integrationSlug}`;
