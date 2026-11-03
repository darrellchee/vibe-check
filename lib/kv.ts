// The small set of storage operations a deployed copy needs, with one implementation per kind of
// database. Every operation that guards access is a single atomic step in the database itself:
// claiming the site (first writer wins), redeeming a connect code (exactly once) and saving a
// snapshot (only if newer). The SQL versions keep those guarantees with one statement each.
//
// The backend is chosen from the environment variables the Vercel integration injected, in this
// order: Upstash REST, REDIS_URL (Redis Cloud, Valkey, any Redis), Turso, then Postgres (Neon,
// Supabase). Drivers for the TCP databases load only when that database is in use.

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  // Writes only when the key is absent or expired. True when this call wrote it.
  setIfAbsent(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  // Reads and deletes in one step, so a value can be taken exactly once.
  take(key: string): Promise<string | null>;
  addMember(set: string, member: string): Promise<void>;
  hasMember(set: string, member: string): Promise<boolean>;
  // Replaces the value only when `version` sorts after the stored version (ISO timestamps).
  putIfNewer(key: string, version: string, value: string): Promise<boolean>;
}

export type StorageBackend =
  | { kind: "upstash"; url: string; token: string }
  | { kind: "redis"; url: string }
  | { kind: "turso"; url: string; token: string }
  | { kind: "postgres"; url: string };

const TIMEOUT_MS = 15_000;
const env = (name: string) => process.env[name]?.trim() || undefined;

function parseUrl(value: string, label: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
}

// Which database this deployment uses, or null when none is connected. Throws when one is only
// half configured, so a typo never silently falls through to a different database.
export function storageBackend(): StorageBackend | null {
  const restUrl = env("UPSTASH_REDIS_REST_URL") || env("KV_REST_API_URL"),
    restToken = env("UPSTASH_REDIS_REST_TOKEN") || env("KV_REST_API_TOKEN");
  if (restUrl || restToken) {
    if (!restUrl || !restToken) throw new Error("Both Upstash environment variables are required.");
    if (!restUrl.startsWith("https://")) throw new Error("Cloud storage requires HTTPS.");
    return { kind: "upstash", url: restUrl, token: restToken };
  }

  const redisUrl = env("REDIS_URL");
  if (redisUrl) {
    const url = parseUrl(redisUrl, "REDIS_URL");
    if (url.protocol !== "redis:" && url.protocol !== "rediss:")
      throw new Error("REDIS_URL must start with redis:// or rediss://.");
    return { kind: "redis", url: redisUrl };
  }

  const tursoUrl = env("TURSO_DATABASE_URL"),
    tursoToken = env("TURSO_AUTH_TOKEN");
  if (tursoUrl || tursoToken) {
    if (!tursoUrl || !tursoToken) throw new Error("Both Turso environment variables are required.");
    const url = parseUrl(tursoUrl, "TURSO_DATABASE_URL");
    // libsql:// is Turso's name for its HTTPS endpoint.
    if (url.protocol !== "libsql:" && url.protocol !== "https:") throw new Error("Cloud storage requires HTTPS.");
    return { kind: "turso", url: `https://${url.host}`, token: tursoToken };
  }

  // DATABASE_URL is Neon's pooled connection; POSTGRES_URL is Supabase's (and Neon's older name).
  const postgresUrl = env("DATABASE_URL") || env("POSTGRES_URL");
  if (postgresUrl) {
    const url = parseUrl(postgresUrl, "DATABASE_URL");
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
      throw new Error("DATABASE_URL must be a postgres:// connection string.");
    return { kind: "postgres", url: postgresUrl };
  }
  return null;
}

let cached: { id: string; store: KeyValueStore } | null = null;

export function kv(): KeyValueStore {
  const backend = storageBackend();
  if (!backend)
    throw new Error("Cloud storage is not configured. Connect a database to this project in Vercel.");
  const id = JSON.stringify(backend);
  if (cached?.id !== id) cached = { id, store: createStore(backend) };
  return cached.store;
}

function createStore(backend: StorageBackend): KeyValueStore {
  switch (backend.kind) {
    case "upstash":
      return redisCommandStore((command) => upstashCommand(backend, command));
    case "redis":
      return redisCommandStore((command) => redisTcpCommand(backend.url, command));
    case "turso":
      return tursoStore((statements) => tursoPipeline(backend, statements));
    case "postgres":
      return postgresStore(postgresQuery(backend.url));
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Cloud storage did not respond in time.")), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ---------- Redis (Upstash over HTTPS, or any Redis over TCP) ---------- */

type RedisCommand = (string | number)[];

// Compare and replace atomically so slow collectors cannot overwrite newer data.
const SAVE_IF_NEWER =
  "local old = redis.call('GET', KEYS[1]); if old then local parsed = cjson.decode(old); if parsed.generatedAt >= ARGV[1] then return 0 end end; redis.call('SET', KEYS[1], ARGV[2]); return 1";

function redisCommandStore(send: (command: RedisCommand) => Promise<unknown>): KeyValueStore {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    get: async (key) => text(await send(["GET", key])),
    setIfAbsent: async (key, value, ttlSeconds) =>
      (await send(["SET", key, value, ...(ttlSeconds ? ["EX", ttlSeconds] : []), "NX"])) === "OK",
    take: async (key) => text(await send(["GETDEL", key])),
    addMember: async (set, member) => void (await send(["SADD", set, member])),
    hasMember: async (set, member) => Number(await send(["SISMEMBER", set, member])) === 1,
    // The stored value is the snapshot JSON, whose generatedAt is the version.
    putIfNewer: async (key, version, value) =>
      Number(await send(["EVAL", SAVE_IF_NEWER, 1, key, version, value])) === 1,
  };
}

async function upstashCommand({ url, token }: { url: string; token: string }, command: RedisCommand) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Cloud storage is unavailable.");
  const result = await response.json();
  if (result.error) throw new Error("Cloud storage rejected the operation.");
  return result.result;
}

type RedisClient = { isOpen: boolean; sendCommand(args: string[]): Promise<unknown> };
const redisClients = new Map<string, Promise<RedisClient>>();

// One connection per server instance, reused across requests. A few quick retries ride out a blip;
// after that the client gives up, so a wrong password or a dead server fails in about a second
// instead of every request waiting for the timeout. The next request then starts a fresh client.
async function redisClient(url: string): Promise<RedisClient> {
  const existing = redisClients.get(url);
  if (existing) {
    const client = await existing.catch(() => null);
    if (client?.isOpen) return client;
    if (redisClients.get(url) === existing) redisClients.delete(url);
  }
  let client = redisClients.get(url);
  if (!client) {
    client = (async () => {
      const { createClient } = await import("@redis/client");
      const c = createClient({
        url,
        socket: {
          connectTimeout: 5_000,
          reconnectStrategy: (retries: number, cause: Error) => (retries >= 3 ? cause : 100 * 2 ** retries),
        },
      });
      // Failures reach callers as rejected commands; the event only needs a listener.
      c.on("error", () => {});
      await c.connect();
      return c as unknown as RedisClient;
    })();
    redisClients.set(url, client);
    client.catch(() => {
      if (redisClients.get(url) === client) redisClients.delete(url);
    });
  }
  return client;
}

async function redisTcpCommand(url: string, command: RedisCommand) {
  try {
    return await withTimeout(redisClient(url).then((c) => c.sendCommand(command.map(String))));
  } catch {
    throw new Error("Cloud storage is unavailable.");
  }
}

/* ---------- SQL (Turso over HTTPS, Postgres over TCP) ---------- */

type SqlArg = string | number | null;
type Statement = { sql: string; args: SqlArg[] };
type Row = Record<string, unknown>;

// Turso is SQLite: no schemas, so the tables carry the app's prefix instead.
const SQLITE_SCHEMA: Statement[] = [
  { sql: "CREATE TABLE IF NOT EXISTS vibe_check_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, version TEXT, expires_at INTEGER)", args: [] },
  { sql: "CREATE TABLE IF NOT EXISTS vibe_check_set_members (set_key TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY (set_key, member))", args: [] },
];

// SQLite has no shared clock here, so expiry times are this server's milliseconds since epoch.
function tursoStore(run: (statements: Statement[]) => Promise<Row[]>): KeyValueStore {
  const one = async (sql: string, ...args: SqlArg[]) => (await run([{ sql, args }]))[0];
  return {
    get: async (key) => {
      const row = await one("SELECT value FROM vibe_check_kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)", key, Date.now());
      return typeof row?.value === "string" ? row.value : null;
    },
    setIfAbsent: async (key, value, ttlSeconds) => {
      const now = Date.now();
      const rows = await run([
        // Expired codes are swept whenever a new one is made, so the table stays small.
        { sql: "DELETE FROM vibe_check_kv WHERE expires_at <= ?", args: [now] },
        {
          sql: `INSERT INTO vibe_check_kv (key, value, expires_at) VALUES (?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, version = NULL
            WHERE vibe_check_kv.expires_at IS NOT NULL AND vibe_check_kv.expires_at <= ?
            RETURNING 1 AS saved`,
          args: [key, value, ttlSeconds ? now + ttlSeconds * 1000 : null, now],
        },
      ]);
      return rows.length === 1;
    },
    take: async (key) => {
      const row = await one("DELETE FROM vibe_check_kv WHERE key = ? RETURNING value, expires_at", key);
      if (typeof row?.value !== "string") return null;
      return row.expires_at === null || Number(row.expires_at) > Date.now() ? row.value : null;
    },
    addMember: async (set, member) =>
      void (await one("INSERT INTO vibe_check_set_members (set_key, member) VALUES (?, ?) ON CONFLICT DO NOTHING", set, member)),
    hasMember: async (set, member) =>
      (await one("SELECT 1 AS found FROM vibe_check_set_members WHERE set_key = ? AND member = ?", set, member)) !== undefined,
    // SQLite compares TEXT byte by byte, which orders ISO timestamps correctly.
    putIfNewer: async (key, version, value) =>
      (await one(
        `INSERT INTO vibe_check_kv (key, value, version) VALUES (?, ?, ?)
          ON CONFLICT (key) DO UPDATE SET value = excluded.value, version = excluded.version, expires_at = NULL
          WHERE vibe_check_kv.version IS NULL OR vibe_check_kv.version < excluded.version
          RETURNING 1 AS saved`,
        key, value, version,
      )) !== undefined,
  };
}

type TursoValue = { type: "null" } | { type: "integer" | "text"; value: string } | { type: "float"; value: number } | { type: "blob"; base64: string };
type TursoResult =
  | { type: "ok"; response: { type: string; result?: { cols: { name: string }[]; rows: TursoValue[][] } } }
  | { type: "error"; error: { message: string } };

const tursoReady = new Set<string>();
const toTurso = (arg: SqlArg): TursoValue =>
  arg === null ? { type: "null" } : typeof arg === "number" ? { type: "integer", value: String(Math.trunc(arg)) } : { type: "text", value: arg };
const fromTurso = (cell: TursoValue) => (cell.type === "null" ? null : cell.type === "blob" ? cell.base64 : cell.value);

// Turso's HTTP API runs a list of statements in order on one connection. Returns the last one's rows.
async function tursoPipeline({ url, token }: { url: string; token: string }, statements: Statement[]): Promise<Row[]> {
  const ready = tursoReady.has(url);
  const all = ready ? statements : [...SQLITE_SCHEMA, ...statements];
  const response = await fetch(`${url}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        ...all.map(({ sql, args }) => ({ type: "execute", stmt: { sql, args: args.map(toTurso) } })),
        { type: "close" },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Cloud storage is unavailable.");
  const { results } = (await response.json()) as { results: TursoResult[] };
  if (!Array.isArray(results) || results.some((r) => r.type !== "ok"))
    throw new Error("Cloud storage rejected the operation.");
  tursoReady.add(url);
  const last = results[all.length - 1];
  const result = last.type === "ok" ? last.response.result : undefined;
  if (!result) return [];
  return result.rows.map((row) => Object.fromEntries(result.cols.map((col, i) => [col.name, fromTurso(row[i])])));
}

// Postgres gets its own schema: Supabase publishes the public schema through its REST API, and row
// level security with no policies keeps even that path closed. The app connects as the owner.
const POSTGRES_SCHEMA = `
  CREATE SCHEMA IF NOT EXISTS vibe_check;
  CREATE TABLE IF NOT EXISTS vibe_check.kv (key text PRIMARY KEY, value text NOT NULL, version text COLLATE "C", expires_at timestamptz);
  CREATE TABLE IF NOT EXISTS vibe_check.set_members (set_key text NOT NULL, member text NOT NULL, PRIMARY KEY (set_key, member));
  ALTER TABLE vibe_check.kv ENABLE ROW LEVEL SECURITY;
  ALTER TABLE vibe_check.set_members ENABLE ROW LEVEL SECURITY;`;

export function postgresStore(query: (sql: string, args: SqlArg[]) => Promise<Row[]>): KeyValueStore {
  const one = async (sql: string, ...args: SqlArg[]) => (await query(sql, args))[0];
  return {
    get: async (key) => {
      const row = await one("SELECT value FROM vibe_check.kv WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())", key);
      return typeof row?.value === "string" ? row.value : null;
    },
    setIfAbsent: async (key, value, ttlSeconds) => {
      if (ttlSeconds) await query("DELETE FROM vibe_check.kv WHERE expires_at <= now()", []);
      const row = await one(
        `INSERT INTO vibe_check.kv (key, value, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, version = NULL
          WHERE vibe_check.kv.expires_at IS NOT NULL AND vibe_check.kv.expires_at <= now()
          RETURNING 1 AS saved`,
        key, value, ttlSeconds ?? null,
      );
      return row !== undefined;
    },
    take: async (key) => {
      const row = await one("DELETE FROM vibe_check.kv WHERE key = $1 RETURNING value, (expires_at IS NULL OR expires_at > now()) AS live", key);
      return row?.live === true && typeof row.value === "string" ? row.value : null;
    },
    addMember: async (set, member) =>
      void (await query("INSERT INTO vibe_check.set_members (set_key, member) VALUES ($1, $2) ON CONFLICT DO NOTHING", [set, member])),
    hasMember: async (set, member) =>
      (await one("SELECT 1 AS found FROM vibe_check.set_members WHERE set_key = $1 AND member = $2", set, member)) !== undefined,
    // The version column sorts byte by byte (COLLATE "C"), which orders ISO timestamps correctly.
    putIfNewer: async (key, version, value) =>
      (await one(
        `INSERT INTO vibe_check.kv (key, value, version) VALUES ($1, $2, $3)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, expires_at = NULL
          WHERE vibe_check.kv.version IS NULL OR vibe_check.kv.version < EXCLUDED.version
          RETURNING 1 AS saved`,
        key, value, version,
      )) !== undefined,
  };
}

type Sql = { unsafe(query: string, args?: SqlArg[]): Promise<Row[]> };
const postgresClients = new Map<string, Promise<Sql>>();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function postgresClient(connection: string) {
  let client = postgresClients.get(connection);
  if (!client) {
    client = (async () => {
      const { default: postgres } = await import("postgres");
      const url = new URL(connection);
      const host = url.hostname;
      // Provider extras in the query string (sslmode, channel_binding, supa, pgbouncer) would be sent
      // to the server as settings, which poolers reject. TLS is set here instead.
      url.search = "";
      const sql = postgres(url.href, {
        // Certificates are checked, except Supabase's pooler, which is signed by Supabase's own CA.
        ssl: LOCAL_HOSTS.has(host) ? false : /\.supabase\.(co|com)$/.test(host) ? "require" : "verify-full",
        // Neon and Supabase hand out pooled (transaction mode) URLs, which cannot keep prepared statements.
        prepare: false,
        max: 3,
        idle_timeout: 20,
        connect_timeout: 10,
        onnotice: () => {},
      }) as unknown as Sql;
      try {
        await sql.unsafe(POSTGRES_SCHEMA);
      } catch {
        // Two servers starting at once can race on CREATE ... IF NOT EXISTS. The second try sees the tables.
        await sql.unsafe(POSTGRES_SCHEMA);
      }
      return sql;
    })();
    postgresClients.set(connection, client);
    client.catch(() => postgresClients.delete(connection));
  }
  return client;
}

function postgresQuery(connection: string) {
  return async (sql: string, args: SqlArg[]) => {
    try {
      return await withTimeout(postgresClient(connection).then((c) => c.unsafe(sql, args)));
    } catch {
      throw new Error("Cloud storage is unavailable.");
    }
  };
}
