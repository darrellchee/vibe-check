import type { UsageSnapshot } from "./types";
type Obj = Record<string, unknown>;
const tokenKeys = [
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
];
const dayKeys = [
  ...tokenKeys,
  "date",
  "models",
  "sessions",
  "humanRequests",
  "assistantRequests",
  "costUsd",
  "unpricedTokens",
];
const modelKeys = [
  ...tokenKeys,
  "model",
  "costUsd",
  "requests",
  "priced",
  "unpricedTokens",
];
function object(
  v: unknown,
  keys: string[],
  optional: string[] = [],
): asserts v is Obj {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k) && !optional.includes(k)) ||
    keys.some((k) => !(k in v))
  )
    throw new Error("Unexpected snapshot fields.");
}
function numeric(v: unknown) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < 0 ||
    v > Number.MAX_SAFE_INTEGER
  )
    throw new Error("Invalid numeric usage.");
}
function timestamp(v: unknown, nullable = false) {
  if (nullable && v === null) return;
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\dT/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString() !== v
  )
    throw new Error("Invalid timestamp.");
}
function date(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\d$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new Error("Invalid date.");
}
function tokens(v: Obj) {
  tokenKeys.forEach((k) => {
    numeric(v[k]);
    if (!Number.isSafeInteger(v[k]))
      throw new Error("Token counts must be integers.");
  });
  if (
    "unpricedTokens" in v &&
    (!Number.isSafeInteger(v.unpricedTokens) ||
      Number(v.unpricedTokens) < 0 ||
      Number(v.unpricedTokens) > Number(v.totalTokens))
  )
    throw new Error("Invalid unpriced token total.");
  if (
    Number(v.inputTokens) + Number(v.outputTokens) !== v.totalTokens ||
    Number(v.cachedInputTokens) + Number(v.cacheWriteTokens) >
      Number(v.inputTokens) ||
    Number(v.reasoningTokens) > Number(v.outputTokens)
  )
    throw new Error("Inconsistent token totals.");
}
function models(value: unknown) {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error("Invalid model data.");
  for (const m of value) {
    object(m, modelKeys);
    tokens(m);
    ["costUsd", "requests", "unpricedTokens"].forEach((k) => numeric(m[k]));
    if (
      typeof m.priced !== "boolean" ||
      typeof m.model !== "string" ||
      !/^[a-zA-Z0-9._:/-]{1,100}$/.test(m.model)
    )
      throw new Error("Invalid model.");
  }
}
export function validateSnapshot(value: unknown): UsageSnapshot {
  object(
    value,
    [
      "version",
      "generatedAt",
      "source",
      "timezone",
      "coverage",
      "totals",
      "models",
      "daily",
      "hours",
      "mostExpensiveDay",
      "mostExpensive24h",
      "pricing",
    ],
    ["provider", "availability"],
  );
  if (
    "provider" in value &&
    value.provider !== "codex" &&
    value.provider !== "claude" &&
    value.provider !== "cursor" &&
    value.provider !== "antigravity"
  )
    throw new Error("Unsupported usage provider.");
  if ("availability" in value) {
    object(value.availability, [
      "tokens",
      "cost",
      "sessions",
      "humanRequests",
      "assistantRequests",
      "cacheBreakdown",
    ]);
    if (Object.values(value.availability).some((v) => typeof v !== "boolean"))
      throw new Error("Invalid metric availability.");
  }
  if (value.version !== 1 || !["local", "cloud"].includes(String(value.source)))
    throw new Error("Unsupported snapshot version.");
  timestamp(value.generatedAt);
  if (Date.parse(String(value.generatedAt)) > Date.now() + 300_000)
    throw new Error("Snapshot time is in the future.");
  if (typeof value.timezone !== "string" || value.timezone.length > 80)
    throw new Error("Invalid timezone.");
  new Intl.DateTimeFormat("en", { timeZone: value.timezone });
  object(value.coverage, [
    "firstEvent",
    "lastEvent",
    "filesScanned",
    "malformedLines",
    "warnings",
  ]);
  timestamp(value.coverage.firstEvent, true);
  timestamp(value.coverage.lastEvent, true);
  numeric(value.coverage.filesScanned);
  numeric(value.coverage.malformedLines);
  if (
    !Array.isArray(value.coverage.warnings) ||
    value.coverage.warnings.length > 30 ||
    value.coverage.warnings.some(
      (w) => typeof w !== "string" || w.length > 1000,
    )
  )
    throw new Error("Invalid coverage warnings.");
  object(value.totals, [
    ...tokenKeys,
    "sessions",
    "humanRequests",
    "assistantRequests",
    "averageTokensPerSession",
    "costUsd",
    "unpricedTokens",
  ]);
  tokens(value.totals);
  Object.values(value.totals).forEach(numeric);
  models(value.models);
  if (!Array.isArray(value.daily) || value.daily.length > 40_000)
    throw new Error("Invalid daily data.");
  for (const d of value.daily) {
    object(d, dayKeys);
    tokens(d);
    date(d.date);
    models(d.models);
    [
      "sessions",
      "humanRequests",
      "assistantRequests",
      "costUsd",
      "unpricedTokens",
    ].forEach((k) => numeric(d[k]));
  }
  if (!Array.isArray(value.hours) || value.hours.length !== 24)
    throw new Error("Invalid hourly data.");
  for (let i = 0; i < 24; i++) {
    const h = value.hours[i];
    object(h, ["hour", "tokens", "requests"]);
    if (h.hour !== i) throw new Error("Invalid hour.");
    numeric(h.tokens);
    numeric(h.requests);
  }
  if (value.mostExpensiveDay !== null) {
    object(value.mostExpensiveDay, ["date", "costUsd", "tokens"]);
    date(value.mostExpensiveDay.date);
    numeric(value.mostExpensiveDay.costUsd);
    numeric(value.mostExpensiveDay.tokens);
  }
  if (value.mostExpensive24h !== null) {
    object(value.mostExpensive24h, ["start", "end", "costUsd", "tokens"]);
    timestamp(value.mostExpensive24h.start);
    timestamp(value.mostExpensive24h.end);
    numeric(value.mostExpensive24h.costUsd);
    numeric(value.mostExpensive24h.tokens);
  }
  object(value.pricing, ["checkedAt", "sources"]);
  date(value.pricing.checkedAt);
  if (
    !Array.isArray(value.pricing.sources) ||
    value.pricing.sources.length > 20 ||
    value.pricing.sources.some(
      (s) =>
        typeof s !== "string" ||
        !/^https:\/\/(developers\.openai\.com|openai\.com|help\.openai\.com|platform\.claude\.com|docs\.claude\.com|www\.anthropic\.com|anthropic\.com|cursor\.com|www\.cursor\.com|docs\.cursor\.com|ai\.google\.dev|antigravity\.google)\//.test(
          s,
        ) ||
        s.length > 300,
    )
  )
    throw new Error("Invalid pricing sources.");
  const snapshot = value as unknown as UsageSnapshot;
  const close = (a: number, b: number) =>
    Math.abs(a - b) <= Math.max(1e-7, Math.abs(a) * 1e-10);
  const assertEqual = (a: number, b: number) => {
    if (!close(a, b)) throw new Error("Inconsistent aggregate totals.");
  };
  for (const key of tokenKeys as (keyof import("./types").TokenTotals)[]) {
    assertEqual(
      snapshot.models.reduce((sum, m) => sum + m[key], 0),
      snapshot.totals[key],
    );
    assertEqual(
      snapshot.daily.reduce((sum, d) => sum + d[key], 0),
      snapshot.totals[key],
    );
  }
  assertEqual(
    snapshot.hours.reduce((sum, h) => sum + h.tokens, 0),
    snapshot.totals.totalTokens,
  );
  assertEqual(
    snapshot.hours.reduce((sum, h) => sum + h.requests, 0),
    snapshot.totals.assistantRequests,
  );
  assertEqual(
    snapshot.models.reduce((sum, m) => sum + m.requests, 0),
    snapshot.totals.assistantRequests,
  );
  for (const key of [
    "costUsd",
    "unpricedTokens",
    "humanRequests",
    "assistantRequests",
  ] as const)
    assertEqual(
      snapshot.daily.reduce((sum, d) => sum + d[key], 0),
      snapshot.totals[key],
    );
  for (const key of ["costUsd", "unpricedTokens"] as const)
    assertEqual(
      snapshot.models.reduce((sum, m) => sum + m[key], 0),
      snapshot.totals[key],
    );
  assertEqual(
    snapshot.totals.averageTokensPerSession,
    snapshot.totals.sessions
      ? snapshot.totals.totalTokens / snapshot.totals.sessions
      : 0,
  );
  if (
    new Set(snapshot.models.map((m) => m.model)).size !==
      snapshot.models.length ||
    new Set(snapshot.daily.map((d) => d.date)).size !== snapshot.daily.length
  )
    throw new Error("Duplicate aggregate groups.");
  for (const d of snapshot.daily) {
    if (new Set(d.models.map((m) => m.model)).size !== d.models.length)
      throw new Error("Duplicate aggregate groups.");
    for (const key of tokenKeys as (keyof import("./types").TokenTotals)[])
      assertEqual(
        d.models.reduce((sum, m) => sum + m[key], 0),
        d[key],
      );
    assertEqual(
      d.models.reduce((sum, m) => sum + m.requests, 0),
      d.assistantRequests,
    );
    assertEqual(
      d.models.reduce((sum, m) => sum + m.costUsd, 0),
      d.costUsd,
    );
    assertEqual(
      d.models.reduce((sum, m) => sum + m.unpricedTokens, 0),
      d.unpricedTokens,
    );
  }
  if (
    snapshot.mostExpensive24h &&
    Date.parse(snapshot.mostExpensive24h.end) -
      Date.parse(snapshot.mostExpensive24h.start) !==
      86_400_000
  )
    throw new Error("Invalid rolling window.");
  if (snapshot.availability) {
    const availability = snapshot.availability;
    if (!availability.tokens && snapshot.totals.totalTokens !== 0)
      throw new Error(
        "Unavailable token metric must not contain token counts.",
      );
    if (!availability.cost && snapshot.totals.costUsd !== 0)
      throw new Error(
        "Unavailable cost metric must not contain a cost estimate.",
      );
    if (!availability.sessions && snapshot.totals.sessions !== 0)
      throw new Error("Unavailable sessions metric must not contain a count.");
    if (!availability.humanRequests && snapshot.totals.humanRequests !== 0)
      throw new Error(
        "Unavailable human request metric must not contain a count.",
      );
    if (
      !availability.assistantRequests &&
      snapshot.totals.assistantRequests !== 0
    )
      throw new Error(
        "Unavailable model request metric must not contain a count.",
      );
    if (
      !availability.cacheBreakdown &&
      (snapshot.totals.cachedInputTokens !== 0 ||
        snapshot.totals.cacheWriteTokens !== 0)
    )
      throw new Error(
        "Unavailable cache metric must not contain cache counts.",
      );
  }
  return snapshot;
}
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new Error("Payload too large.");
  if (!request.body) throw new Error("Empty request body.");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Payload too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(all));
}
