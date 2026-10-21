import { appendFile, mkdir, open, stat } from "node:fs/promises";
import path from "node:path";
import type { TokenTotals } from "./types";

// Claude Code deletes transcripts older than `cleanupPeriodDays` (default 30),
// and the transcripts are the only record of Claude Code usage. This private,
// append-only ledger keeps the numbers the collector derives from them so that
// history survives that cleanup.
//
// It stores only what the dashboard already reports: one-way hashed event and
// session IDs, timestamps, model names and token counts. It never contains
// prompts, responses, project paths or raw IDs, is never uploaded, and is
// created owner-only. Loading rejects any record that is not in that shape.
export type ClaudeEvent = {
  id: string;
  timestamp: string;
  session: string;
  model: string;
  tokens: TokenTotals;
  write1hTokens: number;
  speed?: string;
  serviceTier?: string;
  inferenceGeo?: string;
};
export type ClaudeHuman = { id: string; timestamp: string; session: string };
export type Ledger = {
  events: ReadonlyMap<string, ClaudeEvent>;
  humans: ReadonlyMap<string, ClaudeHuman>;
  malformed: number;
};

const zero = (): TokenTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});
export const tokenKeys = Object.keys(zero()) as (keyof TokenTotals)[];

export function mergeEvent(target: Map<string, ClaudeEvent>, event: ClaudeEvent) {
  const previous = target.get(event.id);
  if (!previous) {
    target.set(event.id, event);
    return;
  }
  // Streaming content blocks repeat input and contain cumulative output usage.
  // Keep a fresh normalized record so cached parsed files remain immutable.
  const tokens = { ...previous.tokens };
  for (const key of tokenKeys)
    tokens[key] = Math.max(tokens[key], event.tokens[key]);
  tokens.totalTokens = tokens.inputTokens + tokens.outputTokens;
  target.set(event.id, {
    ...previous,
    ...event,
    model: event.model === "unknown" ? previous.model : event.model,
    speed: event.speed ?? previous.speed,
    serviceTier: event.serviceTier ?? previous.serviceTier,
    inferenceGeo: event.inferenceGeo ?? previous.inferenceGeo,
    timestamp:
      previous.timestamp < event.timestamp
        ? previous.timestamp
        : event.timestamp,
    tokens,
    write1hTokens: Math.max(previous.write1hTokens, event.write1hTokens),
  });
}

// Lines are compact positional JSON arrays:
//   ["v",1]
//   ["e",id,timestamp,session,model,[input,cached,write,output,reasoning],write1h,speed,tier,geo]
//   ["h",id,timestamp,session]
const MAX_LEDGER_BYTES = 256 * 1024 * 1024;
const hashed = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{32}$/.test(v);
const when = (v: unknown): v is string =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const label = (v: unknown): string | undefined | null =>
  v === null || v === undefined
    ? undefined
    : // Providers sometimes record an empty string (e.g. inference_geo: ""),
      // which is kept as-is rather than treated as absent.
      typeof v === "string" && /^[a-zA-Z0-9._:/-]{0,50}$/.test(v)
      ? v
      : null;

type State = {
  offset: number;
  carry: string;
  events: Map<string, ClaudeEvent>;
  humans: Map<string, ClaudeHuman>;
  malformed: number;
};
const states = new Map<string, State>();
const fresh = (): State => ({
  offset: 0,
  carry: "",
  events: new Map(),
  humans: new Map(),
  malformed: 0,
});

function fold(state: State, line: string) {
  if (!line.trim()) return;
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    state.malformed++;
    return;
  }
  if (!Array.isArray(row)) {
    state.malformed++;
    return;
  }
  if (row[0] === "v") return;
  if (row[0] === "h") {
    const [, id, timestamp, session] = row;
    if (hashed(id) && when(timestamp) && hashed(session))
      state.humans.set(id, { id, timestamp, session });
    else state.malformed++;
    return;
  }
  if (row[0] === "e") {
    const [, id, timestamp, session, model, k, write1hTokens, a, b, c] = row;
    const speed = label(a),
      serviceTier = label(b),
      inferenceGeo = label(c);
    if (
      hashed(id) &&
      when(timestamp) &&
      hashed(session) &&
      typeof model === "string" &&
      /^[a-zA-Z0-9._:/-]{1,100}$/.test(model) &&
      Array.isArray(k) &&
      k.length === 5 &&
      k.every(count) &&
      count(write1hTokens) &&
      speed !== null &&
      serviceTier !== null &&
      inferenceGeo !== null
    ) {
      const [inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens] =
        k as number[];
      mergeEvent(state.events, {
        id,
        timestamp,
        session,
        model,
        tokens: {
          inputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          outputTokens,
          reasoningTokens,
          totalTokens: inputTokens + outputTokens,
        },
        write1hTokens,
        speed,
        serviceTier,
        inferenceGeo,
      });
    } else state.malformed++;
    return;
  }
  state.malformed++;
}

// Append-only, so only bytes added since the last read are parsed. A shrunken
// file (replaced or truncated) is re-read from the start.
export async function loadLedger(file: string): Promise<Ledger> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      states.delete(file);
      return { events: new Map(), humans: new Map(), malformed: 0 };
    }
    throw error;
  }
  if (size > MAX_LEDGER_BYTES)
    throw new Error("Claude history ledger is unexpectedly large.");
  let state = states.get(file);
  if (!state || size < state.offset) state = fresh();
  if (size > state.offset) {
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(size - state.offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, state.offset);
      const lines = (state.carry + buffer.subarray(0, bytesRead).toString("utf8")).split("\n");
      // The last element is a partial line (or empty) until its newline lands.
      state.carry = lines.pop() ?? "";
      state.offset += bytesRead;
      for (const line of lines) fold(state, line);
    } finally {
      await handle.close();
    }
  }
  states.set(file, state);
  return { events: state.events, humans: state.humans, malformed: state.malformed };
}

export async function appendLedger(
  file: string,
  events: ClaudeEvent[],
  humans: ClaudeHuman[],
) {
  if (!events.length && !humans.length) return;
  const lines: string[] = [];
  const exists = await stat(file).then(
    () => true,
    () => false,
  );
  if (!exists) lines.push(JSON.stringify(["v", 1]));
  for (const e of events)
    lines.push(
      JSON.stringify([
        "e",
        e.id,
        e.timestamp,
        e.session,
        e.model,
        [
          e.tokens.inputTokens,
          e.tokens.cachedInputTokens,
          e.tokens.cacheWriteTokens,
          e.tokens.outputTokens,
          e.tokens.reasoningTokens,
        ],
        e.write1hTokens,
        e.speed ?? null,
        e.serviceTier ?? null,
        e.inferenceGeo ?? null,
      ]),
    );
  for (const h of humans)
    lines.push(JSON.stringify(["h", h.id, h.timestamp, h.session]));
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // The mode applies only when the file is created, so it stays owner-only.
  await appendFile(file, lines.join("\n") + "\n", { mode: 0o600 });
}

export function resetLedgerCache() {
  states.clear();
}
